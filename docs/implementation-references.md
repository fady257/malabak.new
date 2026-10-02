# مراجع التنفيذ الخارجية

توثيق تطوير Pages Functions محلياً: `wrangler pages dev <DIRECTORY-OF-ASSETS>` يخدم الملفات الثابتة وFunctions معًا، ويمكن إعداد المنفذ/العنوان من ملف Wrangler. https://developers.cloudflare.com/pages/functions/local-development/

توثيق إعداد Wrangler لـPages: ملف Wrangler يصبح مصدر إعدادات Pages؛ يتضمن `pages_build_output_dir` وbindings مثل D1، وتجب مراجعة القيم قبل أي نشر. https://developers.cloudflare.com/pages/functions/wrangler-configuration/

توثيق tRPC Fetch/Edge Runtimes adapter: يستخدم `Request` و`Response` الأصليين ويدعم Cloudflare Workers. https://trpc.io/docs/server/adapters/fetch

حدود Cloudflare Workers الرسمية: الخطة المجانية تسمح بـ10ms CPU لكل طلب؛ لذلك يعاد ترميز صور الملاعب عبر Canvas على جهاز المالك، ويقتصر Worker على فحص حاوية WebP وحفظها في D1. https://developers.cloudflare.com/workers/platform/limits/

مرجع حدود D1: حد 2,000,000 بايت للصف/BLOB وحد قاعدة 500MB في الخطة المجانية. https://developers.cloudflare.com/d1/platform/limits/

قاعدة D1 باسم `malabak` موجودة في حساب المستخدم بحسب معلوماته، لكننا لم نُسجل الدخول إلى الحساب ولم نطبق ترحيلًا عن بُعد أو ننشر نسخة؛ التحقق هنا اقتصر على D1 المحلي.
