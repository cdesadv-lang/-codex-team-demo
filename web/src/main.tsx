import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Task = {id:number;title:string;completed:boolean};
async function request<T>(path:string, options:RequestInit = {}):Promise<T> {
  const response = await fetch(`/api/tasks${path}`, {...options, headers:{'Content-Type':'application/json',...options.headers}});
  if (!response.ok) throw new Error('تعذّر إتمام الطلب. تحقق من اتصالك وحاول مجددًا.');
  return response.status === 204 ? undefined as T : response.json();
}
function App(){
 const [tasks,setTasks]=useState<Task[]>([]);
 const [title,setTitle]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [adding,setAdding]=useState(false);
 const [pending,setPending]=useState<number[]>([]);
 const [notice,setNotice]=useState('');
 const input=useRef<HTMLInputElement>(null);
 async function load(){setLoading(true);setError('');try{const data=await request<{tasks:Task[]}>('');setTasks(data.tasks);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function add(event:FormEvent){event.preventDefault();if(!title.trim()||adding)return;setAdding(true);setError('');try{const {task}=await request<{task:Task}>('',{method:'POST',body:JSON.stringify({title:title.trim()})});setTasks(prev=>[task,...prev]);setTitle('');setNotice('تمت إضافة المهمة.');input.current?.focus();}catch(e){setError((e as Error).message);}finally{setAdding(false);}}
 async function update(task:Task,remove=false){setPending(prev=>[...prev,task.id]);setError('');try{if(remove){await request<void>(`/${task.id}`,{method:'DELETE'});setTasks(prev=>prev.filter(t=>t.id!==task.id));setNotice('تم حذف المهمة.');}else{const data=await request<{task:Task}>(`/${task.id}`,{method:'PATCH',body:JSON.stringify({completed:!task.completed})});setTasks(prev=>prev.map(t=>t.id===task.id?data.task:t));setNotice(data.task.completed?'تم إنجاز المهمة.':'تمت إعادة فتح المهمة.');}}catch(e){setError((e as Error).message);}finally{setPending(prev=>prev.filter(id=>id!==task.id));}}
 const completed=tasks.filter(t=>t.completed).length;
 return <div className="shell"><header><a className="brand" href="/" aria-label="مساحة الفريق، الرئيسية"><span className="logo" aria-hidden="true">م</span>مساحة الفريق</a><span className="tag">تطبيق فريق التطوير</span></header><main><section className="intro"><p className="eyebrow">كل إنجاز يبدأ بخطوة</p><h1>أفكار واضحة.<br/><span>مهام مُنجزة.</span></h1><p className="subtitle">مساحة بسيطة لتنظيم أولويات فريقك ومتابعة العمل، خطوة بخطوة.</p></section><section className="board" aria-labelledby="board-title"><div className="board-heading"><div><p className="eyebrow">لوحة العمل</p><h2 id="board-title">مهام الفريق</h2></div><span className="count">{completed} / {tasks.length} مُنجزة</span></div><form onSubmit={add}><label htmlFor="title">ما المهمة التالية؟</label><div className="add-row"><input ref={input} id="title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="مثال: مراجعة خطة الإصدار" maxLength={200} required disabled={loading} autoComplete="off"/><button className="primary" disabled={loading||adding||!title.trim()}>{adding?'جارٍ الإضافة…':'+ إضافة مهمة'}</button></div></form>{error&&<div className="error" role="alert">{error}<button type="button" onClick={()=>void load()} disabled={loading||adding||pending.length>0}>تحديث القائمة</button></div>}<p className="sr-only" role="status">{notice}</p><div aria-busy={loading}>{loading?<p className="empty" role="status">جارٍ تحميل المهام…</p>:tasks.length===0?<div className="empty"><span className="empty-icon" aria-hidden="true">✓</span><h3>{error?'القائمة غير متاحة':'مساحة لإنجازك القادم'}</h3><p>{error?'أعد المحاولة لتحميل مهام الفريق.':'أضف أول مهمة لتبدأ بتنظيم عمل الفريق.'}</p></div>:<ul>{tasks.map(task=><li key={task.id} className={task.completed?'done':''}><label className="task"><input type="checkbox" checked={task.completed} disabled={pending.includes(task.id)} onChange={()=>void update(task)}/><span>{task.title}</span></label><button type="button" className="delete" disabled={pending.includes(task.id)} onClick={()=>void update(task,true)} aria-label={`حذف المهمة: ${task.title}`}>{pending.includes(task.id)?'جارٍ الحفظ…':'حذف'}</button></li>)}</ul>}</div><div className="board-footer"><span className="dot" aria-hidden="true"/>التغييرات تُحفظ في قاعدة البيانات</div></section><footer>مساحة الفريق <span aria-hidden="true">·</span> معًا، نُنجز أكثر</footer></main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
