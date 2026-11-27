/* إعدادات الاتصال بـ Supabase
   ضع هنا قيمتين فقط من لوحة Supabase → Project Settings → API Keys:
     SUPABASE_URL       = رابط المشروع ويبدأ بـ https:// وينتهي بـ .supabase.co
     SUPABASE_ANON_KEY  = المفتاح العام Publishable key ويبدأ بـ sb_publishable_
                          (أو المفتاح القديم anon إن كان مشروعك يعرضه)
   ⚠️ لا تضع هنا أبداً المفتاح السري Secret key (sb_secret_...) ولا مفتاح service_role.
   إذا تركتهما فارغين يعمل الموقع كما كان: الحفظ على هذا الجهاز فقط. */
window.APP_CONFIG = {
  SUPABASE_URL: "https://wsnldtqglqreghpfejmo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_IqpA7L58XD9k-jJ6Lw6XRw_t8z0NAQm",
  // اختياري: حد حجم المرفق بالميغابايت (يجب ألا يتجاوز حد الحاوية في Supabase)
  MAX_FILE_MB: 10
};
