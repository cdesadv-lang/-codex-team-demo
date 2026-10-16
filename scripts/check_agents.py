"""Parse every role and ask the installed Codex parser to load it; no model call."""
from pathlib import Path
import json, os, shutil, subprocess, tempfile, tomllib, threading, queue

root = Path(__file__).resolve().parents[1]
config = tomllib.loads((root / '.codex/config.toml').read_text())
names = ['frontend_engineer', 'backend_engineer', 'qa_engineer', 'security_engineer', 'agent_manager', 'agent_ceo', 'senior_ux_ui_engineer']
assert config['features']['multi_agent'] is True
assert config['sandbox_mode'] == 'workspace-write'
assert config['approval_policy'] == 'on-request'
for name in names:
    role = config['agents'][name]
    path = root / '.codex' / role['config_file']
    data = tomllib.loads(path.read_text())
    assert data['developer_instructions'].strip()
    assert data['sandbox_mode'] == 'workspace-write'
    assert data['approval_policy'] == 'on-request'
assert shutil.which('codex'), 'Codex CLI not installed; TOML checks passed, runtime parsing unavailable'

# Isolated temporary CODEX_HOME avoids modifying user trust/auth or calling a model.
# Validate the complete config and each role layer with the installed strict parser.
for label, source in [('orchestration', root / '.codex/config.toml')] + [(n, root / '.codex/agents' / f'{n}.toml') for n in names]:
    with tempfile.TemporaryDirectory(prefix='codex-roles-') as folder:
        home = Path(folder)
        shutil.copytree(root / '.codex/agents', home / 'agents')
        (home / 'config.toml').write_text(source.read_text())
        messages = [
            {'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'team-validator', 'version': '1.0'}}},
            {'method': 'initialized'},
            {'id': 2, 'method': 'config/read', 'params': {'includeLayers': False}},
        ]
        proc = subprocess.Popen(['codex', 'app-server', '--strict-config'], cwd=folder,
                                env={**os.environ, 'CODEX_HOME': folder},
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        inbox = queue.Queue()
        def collect():
            for line in proc.stdout:
                try: inbox.put(json.loads(line))
                except json.JSONDecodeError: pass
        threading.Thread(target=collect, daemon=True).start()
        reply = None
        try:
            for message in messages:
                proc.stdin.write(json.dumps(message) + '\n')
                proc.stdin.flush()
                if 'id' in message:
                    while True:
                        item = inbox.get(timeout=10)
                        if item.get('id') == message['id']:
                            reply = item
                            break
            assert reply and 'result' in reply, f'{label}: config/read failed: {reply}'
        finally:
            proc.kill()
            proc.communicate(timeout=5)
        effective = reply['result']['config']
        if label == 'orchestration':
            assert all(n in effective['agents'] for n in names)
        else:
            assert effective['developer_instructions'].strip()
        print(f'PASS {label}: TOML + Codex strict config/read (no model execution)')
print(f'PASS: {len(names)} role definitions and orchestration; execution evidence is recorded separately.')
