# تشغيل المعاينة من الموبايل عبر GitHub Codespaces

رابط الإنشاء: https://codespaces.new/cdesadv-lang/-codex-team-demo

افتحه وأنت مسجل بحساب cdesadv-lang، ثم اختر أصغر جهاز (2 cores) وأنشئ البيئة إذا كانت ضمن حصتك المجانية. لا تدخل بطاقة ولا توافق على رسوم. وفق مستندات GitHub، الحساب الشخصي المجاني يشمل120 ساعة core و15GB-month؛ تختلف المدة الفعلية باختلاف عدد الأنوية، وتستهلك البيئة المتوقفة حصة التخزين. بعد التجربة أوقف البيئة واحذفها إن لم تحتجها. إذا نفدت الحصة بدون وسيلة دفع، يمنع GitHub الاستخدام بدل التحصيل. إذا كانت لديك بطاقة/فواتير مفعّلة، تحقق من ميزانية Codespaces صفر مع منع الاستخدام المدفوع قبل الإنشاء؛ لم نتمكن من قراءة ميزانية الحساب عبر التكامل.

بمجرد فتح البيئة، تبني الواجهة تلقائيًا ثم يبدأ سكربت المعاينة عند الاتصال. افتح تبويب Ports والمنفذ3000. الرابط الفعلي ينتهي بـapp.github.dev ويعتمد على اسم البيئة، لذلك لا نخترع رابطًا قبل إنشائها. الرابط private ويتطلب تسجيل دخول GitHub بحساب صاحب البيئة؛ خصوصية المستودع العام مستقلة عن خصوصية المنفذ.

الأمان: .devcontainer/start-preview.sh يطلب ضبط3000:private عبر gh قبل تشغيل الخادم، ويتوقف إذا فشل ذلك. الخادم يستمع على127.0.0.1 فقط ويقبل اسم المعاينة المحدد وOrigin مطابقًا. مصادقة هذا المسار لدى بوابة GitHub؛ لا تضبط المنفذ Public. تشغيل Render الأصلي بكلمة مرور يظل كما هو.

لو فشل فرض الخصوصية لصلاحيات gh داخل Codespace، لن يبدأ التطبيق. تحقق أن المنفذ3000 موجود وPrivate وأن gh متصل بحسابك، ثم أعد تشغيل bash .devcontainer/start-preview.sh. لا تغيره إلىPublic لتجاوز المشكلة.

SQLite في/tmp/codex-codespace مؤقتة وقد تضيع عند إعادة بناء الحاوية أو حذف البيئة؛ هذا مسار معاينة فقط. توقف Codespace يغلق المعاينة. لا خدمات مدفوعة أو قاعدة خارجية.

التحقق المحلي: JSON وbash syntax، صورة Node24 موجودة في Microsoft Container Registry، اختبارات HTTP والإعدادات. لم يُنشأ Codespace من هنا لأن API تجهيز Codespaces أعاد403، ولم يمكن قراءة ميزانية الاستخدام. لم يُختبر forwarding/authentication الفعلي على GitHub بعد.

المراجع: https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace وhttps://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces
