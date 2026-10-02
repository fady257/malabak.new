import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "ar" | "en";

const english: Record<string, string> = {
  "ملعبك": "Malabak",
  "ملعبك — الصفحة الرئيسية": "Malabak — Home",
  "إدارة حجزي": "My booking",
  "دخول المالك": "Owner sign in",
  "جهّز صفحة المكان": "Set up your venue",
  "تابع حجزك": "Track your booking",
  "إعداد حساب المالك": "Set up owner account",
  "الصفحة الرئيسية": "Home",
  "رجوع للموقع": "Back to home",
  "رجوع": "Back",
  "ارجع للرئيسية": "Back to home",
  "مواعيد واضحة. ملعبك جاهز.": "Clear times. Your pitch is ready.",
  "الملعب اللي في بالك،": "The pitch you have in mind,",
  "احجزه من هنا.": "book it right here.",
  "اختار الملعب والساعة المناسبة. هتعرف السعر وحالة الموعد قبل ما تأكد طلبك — ومواعيدك تفضل واضحة قدامك.": "Choose a pitch and time. See the price and availability before you request a booking.",
  "اختار ملعبك": "Choose a pitch",
  "بياناتك محفوظة بأمان، ورمز الحجز يخصك وحدك.": "Your details are stored securely. Only you have your booking code.",
  "موعدك، على اختيارك": "Your time, your choice",
  "حجز واضح من البداية": "Clear booking from the start",
  "يلا نلعب": "Let's play",
  "الوجهة": "The venue",
  "صفحة ملعبك": "Your venue page",
  "بنجهّز مواعيدك…": "Preparing your booking times…",
  "ملاعب": "pitches",
  "صفحة الحجز غير متاحة مؤقتًا. جرّب بعد قليل أو تواصل مع الملعب.": "The booking page is temporarily unavailable. Try again shortly or contact the venue.",
  "لسه ما فيش مكان منشور": "No venue is published yet",
  "ابدأ بإعداد حساب المالك وساعات العمل، وبعدها هتظهر الملاعب هنا.": "Set up the owner account and opening hours; your pitches will appear here.",
  "هيظهر الحجز هنا بمجرد تفعيل صفحة المكان.": "Bookings will appear here once the venue page is enabled.",
  "الملاعب هتظهر هنا قريبًا": "Pitches will appear here soon",
  "تواصل مع المكان لمعرفة المواعيد المتاحة.": "Contact the venue for available times.",
  "صورة": "Photo",
  "ملعب خماسي ": "5-a-side · ",
  "داخلي": "Indoor",
  "خارجي": "Outdoor",
  "اختار ميعاد مناسب وشوف السعر والتفاصيل قبل الحجز.": "Choose a time to see the price and details before booking.",
  "احجز ": "Book ",
  "على ثلاث خطوات": "Three simple steps",
  "الحجز من غير لف.": "Booking, without the runaround.",
  "اختار اليوم والملعب": "Choose a day and pitch",
  "المواعيد المتاحة بس هي اللي هتقدر تختارها.": "Only available times can be selected.",
  "اكتب بيانات الحجز": "Enter your booking details",
  "رمز الحجز خاص بيك؛ احتفظ به علشان تتابع طلبك.": "Your booking code is private. Keep it to track your request.",
  "تابع التأكيد": "Track confirmation",
  "تقدر تستعلم عن الحجز أو تطلب إلغاءه من صفحة إدارة حجزي.": "Look up your booking or request cancellation from My booking.",
  "وقت لعبك، متظبط.": "Your game time, sorted.",
  "إدارة الحجز ": "Manage booking ",
  "الحجز بخطوات واضحة": "A clear booking process",
  "موعد لعبتك،": "Your game time,",
  "اختاره براحتك.": "choose it your way.",
  "المواعيد اللي ظاهرة هنا بتتحدث مع كل حجز. اختار المتاح، وبعدها راجع بياناتك قبل الإرسال.": "Availability updates with every booking. Choose an open time, then review your details before sending.",
  "كل الملاعب": "All pitches",
  "رمز الحجز ورقمك مطلوبان لمتابعة أو إلغاء الطلب.": "Your phone number and booking code are required to track or cancel a request.",
  "١ / اختار موعدك": "1 / Choose a time",
  "الملعب": "Pitch",
  "اليوم": "Date",
  "متاح": "Available",
  "بانتظار التأكيد": "Pending",
  "محجوز — الوقت مشطوب": "Booked — unavailable",
  "بنحدّث المواعيد…": "Updating availability…",
  "تعذر تحميل المواعيد. غيّر اليوم أو حاول مرة أخرى.": "Could not load availability. Change the date or try again.",
  "مفيش مواعيد في اليوم ده. جرّب يوم تاني.": "No times are available on this day. Try another date.",
  "محجوز مؤقتًا": "Temporarily held",
  "محجوز": "Booked",
  "٢ / بيانات الحجز": "2 / Booking details",
  "الاسم": "Name",
  "الاسم اللي هيتسجل عليه الحجز": "Name for the booking",
  "رقم الموبايل": "Mobile number",
  "هنحتاجه مع رمز الحجز لو حبيت تتابع أو تلغي.": "You will need it with your booking code to track or cancel.",
  "العربون المطلوب: ": "Deposit required: ",
  "حوّل إلى فودافون كاش ثم أضف مرجع التحويل. الملعب يراجع الدفع قبل التأكيد.": "Send the deposit by Vodafone Cash, then enter the transfer reference. The venue verifies payment before confirming.",
  "مرجع التحويل": "Transfer reference",
  "رقم العملية أو اسم المحوّل": "Transaction ID or sender name",
  "ملاحظة للملعب (اختياري)": "Note for the venue (optional)",
  "أي معلومة تساعد في تنسيق الموعد": "Anything that helps coordinate your booking",
  "إرسال طلب الحجز ": "Send booking request ",
  "بنحفظ طلبك…": "Saving your request…",
  "إرسال الطلب يحجز الموعد مؤقتًا إلى أن يراجعه الملعب. ما تشاركش رمز الحجز مع حد.": "Your time is held while the venue reviews the request. Do not share your booking code.",
  "الطلب اتحفظ": "Request saved",
  "احتفظ برمز الحجز.": "Keep your booking code.",
  "الموعد محجوز لك مؤقتًا، والملعب هيأكد الطلب بعد مراجعة البيانات.": "Your time is temporarily held. The venue will confirm after reviewing the details.",
  "رمز الحجز": "Booking code",
  "مع رقم موبايلك، الرمز ده بيسمح لك تتابع الحجز أو تطلب إلغاءه.": "Along with your mobile number, this code lets you track or request cancellation.",
  "تابع حالة الحجز": "Track booking status",
  "حجز موعد آخر": "Book another time",
  "رمز الحجز لا يُخزّن كنص في النظام.": "The booking code is not stored in plain text.",
  "استعلام آمن": "Secure lookup",
  "حجزك، في إيدك.": "Your booking, in your hands.",
  "اكتب رمز الحجز ورقم الموبايل المسجل. ما حدش يقدر يشوف أو يلغي الحجز من غير الاتنين.": "Enter your booking code and registered mobile number. Both are required to view or cancel a booking.",
  "رمز الحجز XXXX-XXXX-XXXX-XXXX": "Booking code XXXX-XXXX-XXXX-XXXX",
  "رقم الموبايل المسجل": "Registered mobile number",
  "بندوّر على الحجز…": "Looking up your booking…",
  "عرض حالة الحجز ": "View booking status ",
  "السعر": "Price",
  "الدفع": "Payment",
  "تنتهي المهلة: ": "Hold expires: ",
  "تأكيد طلب إلغاء الحجز؟ يظل سجل الحجز محفوظًا، ويصبح الموعد متاحًا لغيرك.": "Request cancellation? The booking record stays saved, and the time becomes available to others.",
  "بنحفظ الإلغاء…": "Saving cancellation…",
  "إلغاء الحجز": "Cancel booking",
  "سؤال الملعب": "Contact venue",
  "تم إلغاء الحجز؛ بقي سجل التغيير محفوظًا.": "Booking cancelled. The change remains in the record.",
  "ما بنحذفش سجل الحجز، وبنحرر الموعد بأمان بعد الإلغاء.": "The booking record is kept, and the time is safely released after cancellation.",
  "لا تكتب رمز الحجز في مكان عام، ولا تشاركه إلا مع من تثق به.": "Do not enter your booking code in public or share it except with someone you trust.",
  "منطقة المالك": "Owner area",
  "ادخل على ملعبك.": "Sign in to Malabak.",
  "الجدول والحجوزات وإعدادات المكان — من مكان واحد.": "Your schedule, bookings and venue settings — all in one place.",
  "البريد الإلكتروني": "Email address",
  "البريد المسموح للمالك": "Authorized owner email",
  "كلمة المرور": "Password",
  "بنتحقق من البيانات…": "Checking your details…",
  "تسجيل الدخول ": "Sign in ",
  "أول مرة؟": "First time?",
  "أنشئ حساب المالك": "Create owner account",
  "إعداد أول مرة — مرة واحدة فقط": "One-time setup",
  "جهّز المكان على مزاجك.": "Set up your venue your way.",
  "اختار كلمة مرور قوية؛ مش هنحط كلمة افتراضية أو نطلبها منك في المحادثة.": "Choose a strong password. We will not set a default or ask you to send it in chat.",
  "رمز التهيئة لمرة واحدة": "One-time setup token",
  "تجده في OWNER_SETUP_TOKEN داخل ملف .dev.vars المحلي؛ لا تشاركه.": "Find OWNER_SETUP_TOKEN in your local .dev.vars file. Do not share it.",
  "بريد المالك المسموح": "Authorized owner email",
  "اسم المكان": "Venue name",
  "مثال: ملعب الحي": "e.g. Neighborhood Pitch",
  "رابط المكان المختصر": "Venue link slug",
  "حروف إنجليزية صغيرة وأرقام وشرطة فقط.": "Use lowercase English letters, numbers and hyphens only.",
  "عنوان المكان (اختياري)": "Venue address (optional)",
  "ساعات العمل والتسعير": "Opening hours and pricing",
  "يفتح": "Opens",
  "يقفل": "Closes",
  "وقت إغلاق أصغر من الفتح يعني بعد منتصف الليل.": "A closing time earlier than opening means the venue closes after midnight.",
  "مدة الحجز": "Booking duration",
  "٦٠ دقيقة": "60 minutes",
  "٩٠ دقيقة": "90 minutes",
  "سعر الموعد (جنيه)": "Price per slot (EGP)",
  "العربون (جنيه)": "Deposit (EGP)",
  "اكتب 0 لو مش بتطلب عربون.": "Enter 0 if you do not require a deposit.",
  "مهلة الحجز المعلق (دقيقة)": "Pending hold (minutes)",
  "رقم فودافون كاش (اختياري)": "Vodafone Cash number (optional)",
  "كلمة المرور: ١٤ حرفًا على الأقل، وفيها ١٢ حرفًا على الأقل غير المسافات. اخترها بنفسك.": "Password: at least 14 characters, including 12 non-space characters. Choose it yourself.",
  "أكد كلمة المرور": "Confirm password",
  "كلمتا المرور مش متطابقتين.": "Passwords do not match.",
  "اكتب سعرًا صحيحًا للموعد.": "Enter a valid slot price.",
  "الخادم غير جاهز للإعداد بعد. راجع إعدادات تشغيل D1 والأسرار.": "The server is not ready for setup. Check D1 and secret configuration.",
  "بنحفظ الحساب بأمان…": "Saving your account securely…",
  "إنشاء حساب المالك": "Create owner account",
  "جلسة مشفرة وبيانات دخول لا تُرسل لأي طرف آخر.": "Your session is encrypted. Sign-in details are not sent to anyone else.",
  "الصفحة دي مش موجودة": "This page does not exist",
  "شكلنا خرجنا من الملعب.": "Looks like we left the pitch.",
  "جدول اليوم": "Today's schedule",
  "الحجوزات": "Bookings",
  "المكان والملاعب": "Venue and pitches",
  "ملخص الأداء": "Performance summary",
  "بنتأكد من جلسة الدخول…": "Checking your session…",
  "إدارة المكان": "Venue management",
  "المساحة": "Workspace",
  "أقسام لوحة الإدارة": "Dashboard sections",
  "المكان الحالي": "Current venue",
  "تسجيل الخروج": "Sign out",
  "مالك المكان": "Owner",
  "فريق الحجوزات": "Booking team",
  "لوحة المكان": "Venue dashboard",
  "عرض صفحة الحجز ": "View booking page ",
  "محمي": "Protected",
  "تعذر تسجيل الخروج. حاول مرة أخرى.": "Could not sign out. Try again.",
  "سجل اليوم": "Today's records",
  "التشغيل اليومي": "Daily operations",
  "جدول الملعب": "Pitch schedule",
  "كل تغيير بيتحفظ قبل ما يظهر كتأكيد، ومواعيد الحجز المزدوج مرفوضة من قاعدة البيانات.": "Changes are confirmed only after saving; the database prevents double bookings.",
  "تاريخ الجدول": "Schedule date",
  "حجوزات اليوم": "Today's bookings",
  "بانتظارك": "Pending",
  "مؤكدة": "Confirmed",
  "الفترات المأخوذة": "Occupied slots",
  "إضافة حجز يدوي أو أسبوعي": "Add a manual or recurring booking",
  "تحميل الملاعب…": "Loading pitches…",
  "تعذر تحميل الملاعب.": "Could not load pitches.",
  "سجلات": "records",
  "مواعيد نشطة": "active bookings",
  "تحديث الجدول": "Refresh schedule",
  "اليوم فاضي لسه": "No bookings yet today",
  "المواعيد اللي يحجزها العملاء هتظهر هنا. تقدر كمان تضيف حجزًا يدويًا لو فتحت النموذج.": "Customer bookings will appear here. You can also add one manually using the form.",
  "بنحمّل جدول المواعيد…": "Loading the schedule…",
  "تعذر تحميل الحجوزات.": "Could not load bookings.",
  "جاري تحديث المعلومات من قاعدة البيانات…": "Refreshing from the database…",
  "غير مدفوع": "Unpaid",
  "العربون": "Deposit",
  "مدفوع بالكامل": "Paid in full",
  "غير مدفوع بالكامل": "Partially paid",
  "مستلم": "Received",
  "غاب قبل كده ": "Previous no-shows: ",
  "مرة": "times",
  "مرجع: ": "Reference: ",
  "ملاحظة: ": "Note: ",
  "المهلة ": "Hold expires ",
  "تأكيد الحجز ": "Confirm booking ",
  "حفظ حالة الدفع": "Save payment status",
  "رفض الطلب": "Reject request",
  "تغيير الموعد": "Change time",
  "إغلاق التعديل": "Close editor",
  "إلغاء": "Cancel",
  "اكتمل": "Completed",
  "لم يحضر": "No-show",
  "تأكيد إلغاء الحجز؟ سيبقى سجل الحجز محفوظًا، ويتحرر الموعد لغيره.": "Cancel this booking? Its record stays saved and the time is released to others.",
  "اختار الفترة الجديدة": "Choose a new time",
  "الحجز القديم يفضل محفوظ لحد ما الجديد يتأكد.": "The current booking stays until the new time is confirmed.",
  "اليوم الجديد": "New date",
  "الموعد الجديد": "New time",
  "تعذر تحميل الملاعب. ": "Could not load pitches. ",
  "اتحفظ التعديل واتحدث الجدول.": "Change saved; the schedule is up to date.",
  "بنحفظ…": "Saving…",
  "حفظ الموعد الجديد": "Save new time",
  "اتحفظ آخر تعديل": "Latest change saved",
  "موعد محجوز": "Booked",
  "رسالة واتساب": "WhatsApp message",
  "تعديل واضح وحفظ صريح": "Clear edits, explicit save",
  "المعلومات اللي تظهر للعميل عند اختيار الملعب.": "Information shown to customers when choosing a pitch.",
  "العنوان": "Address",
  "وصف المكان": "Venue description",
  "نص قصير وواضح يظهر للعميل.": "A short, clear description for customers.",
  "فودافون كاش": "Vodafone Cash",
  "واتساب التواصل": "WhatsApp contact number",
  "يستخدم رابط واتساب جاهز؛ لا تُرسل رسائل تلقائيًا.": "Opens a pre-filled WhatsApp message; messages are never sent automatically.",
  "المواعيد والأسعار": "Hours and pricing",
  "كل الأوقات بتتفسر على توقيت القاهرة؛ الإغلاق الأقل من الفتح يعني بعد منتصف الليل.": "All times use Cairo time. A closing time earlier than opening means after midnight.",
  "السعر الافتراضي (جنيه)": "Default price (EGP)",
  "آخر وقت للإلغاء (ساعات قبل الموعد)": "Cancellation cutoff (hours before slot)",
  "السماح بالحجز العام": "Allow public booking",
  "عند الإيقاف تختفي صفحة العميل، وتبقى لوحة الإدارة متاحة.": "When disabled, customers cannot book, but the dashboard remains available.",
  "اتحفظت الإعدادات في ": "Settings saved at ",
  "كل صفحة الحجز اتحدثت.": "The booking page is up to date.",
  ". كل صفحة الحجز اتحدثت.": ". The booking page is up to date.",
  "بنحفظ التغييرات…": "Saving changes…",
  "حفظ التغييرات": "Save changes",
  "ما بنعلنش نجاح قبل ما قاعدة البيانات تأكد الحفظ.": "Success is shown only after the database confirms the save.",
  "ملاعب المكان": "Venue pitches",
  "صورة واحدة لكل ملعب؛ رفع صورة جديدة يستبدل القديمة بشكل آمن.": "One cover per pitch. A new upload safely replaces the old one.",
  "تعذر تحميل بيانات الملاعب.": "Could not load pitch details.",
  "اسم الملعب": "Pitch name",
  "وصف قصير": "Short description",
  "نوع الملعب": "Pitch type",
  "حدّد هل الملعب داخلي أو خارجي.": "Choose whether the pitch is indoor or outdoor.",
  "حالة الحجز": "Booking availability",
  "لا يمكن إيقاف ملعب عليه حجوزات قادمة.": "A pitch with upcoming bookings cannot be disabled.",
  "اتحفظت بيانات الملعب.": "Pitch details saved.",
  "اختار JPEG أو PNG أو WebP فقط.": "Choose a JPEG, PNG or WebP image.",
  "الصورة أكبر من الحد المسموح (10 ميجابايت).": "The image exceeds the 10 MB limit.",
  "تم فحص الصورة وحفظها بأمان (": "Image verified and saved securely (",
  "تعذر رفع الصورة.": "Could not upload image.",
  "نشط للحجز": "Open for booking",
  "متوقف عن الحجز": "Closed for booking",
  "إضافة ملعب جديد": "Add a pitch",
  "وصف (اختياري)": "Description (optional)",
  "داخل الصالة؟": "Indoor pitch?",
  "بنضيف…": "Adding…",
  "إضافة الملعب": "Add pitch",
  "تعذر تحميل إعدادات المكان.": "Could not load venue settings.",
  "صفحة الحجز": "Booking page",
  "أسعار خاصة": "Custom prices",
  "أضف سعر المساء أو الجمعة/السبت؛ السعر الافتراضي يظل كما هو لباقي الفترات.": "Set evening or Friday/Saturday prices; the default applies to other times.",
  "الأوقات بعد منتصف الليل تظل ضمن يوم العمل المختار. أسعار الحجوزات القديمة لا تتغير بعد تعديل القواعد.": "After-midnight times remain on the selected business day. Existing bookings keep their saved prices.",
  "الأيام التي ينطبق عليها السعر": "Days this price applies",
  "كل أيام الأسبوع": "Every day",
  "الأحد": "Sunday",
  "الإثنين": "Monday",
  "الثلاثاء": "Tuesday",
  "الأربعاء": "Wednesday",
  "الخميس": "Thursday",
  "الجمعة": "Friday",
  "السبت": "Saturday",
  "من الساعة": "From",
  "إلى الساعة": "Until",
  "السعر (جنيه)": "Price (EGP)",
  "اتحفظت قاعدة السعر؛ الحجوزات السابقة تحتفظ بأسعارها.": "Price rule saved. Existing bookings keep their original prices.",
  "حفظ التعديل": "Save changes",
  "إضافة السعر": "Add price",
  "حذف قاعدة السعر؟ الحجوزات المحفوظة لن تتغير.": "Delete this price rule? Existing bookings will not change.",
  "حذف القاعدة": "Delete rule",
  "لا توجد قواعد خاصة؛ السعر الافتراضي المعيّن أعلاه هو المطبق على كل الأوقات.": "No custom rules. The default price above applies to all times.",
  "إضافة سعر خاص": "Add custom price",
  "الموظف يقدر يدير الحجوزات فقط؛ إعدادات المكان والتقارير للمالك.": "Staff can manage bookings only. Venue settings and reports are owner-only.",
  "تحميل حسابات الفريق…": "Loading team accounts…",
  "تعذر تحميل حسابات الفريق.": "Could not load team accounts.",
  "لا يوجد موظفون مضافون.": "No staff accounts have been added.",
  "حساب فعال · إدارة الحجوزات": "Active · booking management",
  "حساب موقوف": "Account disabled",
  "إيقاف الحساب": "Disable account",
  "إعادة التفعيل": "Reactivate",
  "بريد الموظف": "Staff email",
  "كلمة مرور أولية يحددها المالك": "Initial password set by the owner",
  "١٤ حرفًا على الأقل. لا تُرسل تلقائيًا.": "At least 14 characters. Never sent automatically.",
  "بننشئ الحساب…": "Creating account…",
  "إضافة موظف": "Add staff member",
  "قراءة بسيطة للأرقام": "A clear view of the numbers",
  "حجوزات آخر ٣٠ يوم": "Bookings · last 30 days",
  "مبالغ مستلمة": "Payments received",
  "متوسط الإشغال": "Average occupancy",
  "معدل عدم الحضور": "No-show rate",
  "إجمالي آخر ثلاثين يومًا من الحجوزات المسجلة. الإيراد يعكس المبالغ التي أدخلها المالك كمستلمة.": "Totals for bookings recorded in the last 30 days. Revenue reflects amounts marked as received by the owner.",
  "آخر ٣٠ يوم": "Last 30 days",
  "الساعات الأكثر حجزًا": "Most-booked hours",
  "بناءً على الحجوزات المؤكدة والمكتملة في آخر ٣٠ يومًا.": "Based on confirmed and completed bookings over the last 30 days.",
  "بعد أول حجز مؤكد، هتظهر هنا ساعات الذروة.": "Peak hours will appear here after the first confirmed booking.",
  "الإشغال تقديري: الوحدات المحجوزة ÷ الفترات المفتوحة × الملاعب النشطة. لا يشمل الحجوزات المعلقة أو الملغاة.": "Occupancy is estimated from booked slots ÷ open slots × active pitches. Pending and cancelled bookings are excluded.",
  "بنحسب ملخص الأداء…": "Calculating performance…",
  "تعذر تحميل التحليلات؛ جرّب تحديث الصفحة.": "Could not load analytics. Try refreshing.",
  "أضف ملعبًا نشطًا قبل تسجيل حجز يدوي.": "Add an active pitch before creating a manual booking.",
  "سجّل حجزًا من الملعب": "Record a phone or walk-in booking",
  "نفس قواعد منع التداخل والحفظ تُطبق على الحجز اليدوي.": "Manual bookings use the same overlap prevention and save rules.",
  "اسم العميل": "Customer name",
  "رقم العميل": "Customer phone",
  "التكرار الأسبوعي": "Weekly repeat",
  "مرة واحدة": "Once",
  "أربع أسابيع": "4 weeks",
  "ثمانية أسابيع": "8 weeks",
  "اثنا عشر أسبوعًا": "12 weeks",
  "اثنان وخمسون أسبوعًا": "52 weeks",
  "ملاحظة داخلية (اختياري)": "Internal note (optional)",
  "الموعد يتكرر كل أسبوع بنفس الساعة؛ لو أي أسبوع متعارض مش هيتحفظ أي موعد.": "Repeats at the same time each week. If any week conflicts, none of the bookings are saved.",
  "بنحفظ الحجز…": "Saving booking…",
  "حفظ الحجز": "Save booking",
  "يظهر تأكيد الحفظ بعد انتهاء قاعدة البيانات فقط.": "Success appears only after the database confirms the save.",
  "حجز": "booking",
  "حجوزات": "bookings",
  "بنجمع المواعيد…": "Loading times…",
  "تعذر تحميل الفترات.": "Could not load time slots.",
  "الفترة الحالية": "Current time",
  "بعد منتصف الليل": "After midnight",
  "تعديل الموعد": "Change time",
  "الموعد متاح": "Available",
  "حالة الموعد": "Time status",
  "حدث خطأ. حاول مرة أخرى.": "Something went wrong. Please try again.",
  "انتهت مهلة الحجز المؤقت؛ اختار موعدًا متاحًا من جديد.": "The temporary hold expired. Choose another available time.",
  "اختار موعدًا متاحًا من جديد.": "Please choose another available time.",
  "تم رفض الطلب.": "The request was rejected.",
  "لا يمكن تنفيذ الطلب.": "This request cannot be completed.",
  "بانتظار تأكيد الملعب": "Awaiting venue confirmation",
  "مؤكد": "Confirmed",
  "ملغي": "Cancelled",
  "مرفوض": "Rejected",
  "انتهت المهلة": "Expired",
  "لم يحضر العميل": "Customer did not show",
  "عربون مستلم": "Deposit received",
};

const normalizedEnglish = new Map(Object.entries(english).map(([arabic, value]) => [arabic.trim(), value.trim()]));

const textOriginals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();
const observedAttributes = ["placeholder", "title", "aria-label", "alt"] as const;

function englishText(arabic: string): string | null {
  const exact = normalizedEnglish.get(arabic.trim());
  if (exact !== undefined) return exact;
  if (arabic.includes("،")) {
    const parts = arabic.split("،").map((part) => englishText(part.trim()));
    if (parts.every((part) => part !== null)) return parts.join(", ");
  }
  const afterMidnight = arabic.match(/^بعد منتصف الليل\s*·\s*(.+)$/);
  if (afterMidnight) return `After midnight · ${afterMidnight[1]}`;
  const imageSaved = arabic.match(/^تم فحص الصورة وحفظها بأمان \((.+)\)\.$/);
  if (imageSaved) return `Image verified and saved securely (${imageSaved[1]}).`;
  const staffCreated = arabic.match(/^تم إنشاء حساب (.+)\. لن نرسل كلمة المرور آليًا؛ شاركها مع الموظف عبر وسيلة آمنة\.$/);
  if (staffCreated) return `Account created for ${staffCreated[1]}. The password is not sent automatically; share it securely with the staff member.`;
  const count = arabic.match(/^(\d+) سجلات? · (\d+) مواعيد نشطة$/);
  if (count) return `${count[1]} records · ${count[2]} active bookings`;
  const plural = arabic.match(/^(\d+) ملاعب$/);
  if (plural) return `${plural[1]} pitches`;
  const pitchKind = arabic.match(/^ملعب خماسي (داخلي|خارجي)$/);
  if (pitchKind) return `5-a-side · ${normalizedEnglish.get(pitchKind[1] ?? "") ?? pitchKind[1] ?? ""}`;
  const bookingCount = arabic.match(/^اتحفظ (\d+) (حجز|حجوزات) بنجاح\.$/);
  if (bookingCount) return `${bookingCount[1]} ${Number(bookingCount[1]) === 1 ? "booking" : "bookings"} saved successfully.`;
  const priorNoShows = arabic.match(/^غاب قبل كده (\d+) مرة$/);
  if (priorNoShows) return `Previous no-shows: ${priorNoShows[1]}`;
  const reference = arabic.match(/^مرجع: (.+)$/);
  if (reference) return `Reference: ${reference[1]}`;
  const note = arabic.match(/^ملاحظة: (.+)$/);
  if (note) return `Note: ${note[1]}`;
  const held = arabic.match(/^المهلة (.+)$/);
  if (held) return `Hold expires ${held[1]}`;
  const photo = arabic.match(/^(صورة|غلاف) (.+)$/);
  if (photo) return `${photo[1] === "غلاف" ? "Cover" : "Photo"} of ${photo[2]}`;
  const bookingFor = arabic.match(/^احجز (.+)$/);
  if (bookingFor) return `Book ${bookingFor[1]}`;
  return null;
}

function localizeTextNode(node: Text, locale: AppLocale): void {
  const current = node.data;
  if (locale === "ar") {
    const original = textOriginals.get(node);
    if (original !== undefined && current !== original) node.data = original;
    else if (original === undefined) textOriginals.set(node, current);
    return;
  }
  if (/[\u0600-\u06ff]/u.test(current)) textOriginals.set(node, current);
  const original = textOriginals.get(node) ?? current;
  if (!/[\u0600-\u06ff]/u.test(original)) return;
  const translated = englishText(original.trim());
  if (!translated) return;
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  const next = `${leading}${translated}${trailing}`;
  if (current !== next) node.data = next;
}

function localizeAttribute(element: Element, name: string, locale: AppLocale): void {
  const current = element.getAttribute(name);
  if (current === null) return;
  let originals = attributeOriginals.get(element);
  if (!originals) {
    originals = new Map<string, string>();
    attributeOriginals.set(element, originals);
  }
  if (locale === "ar") {
    const original = originals.get(name);
    if (original !== undefined && current !== original) element.setAttribute(name, original);
    else if (original === undefined) originals.set(name, current);
    return;
  }
  if (/[\u0600-\u06ff]/u.test(current)) originals.set(name, current);
  const original = originals.get(name) ?? current;
  const translated = englishText(original.trim());
  if (translated && current !== translated) element.setAttribute(name, translated);
}

function localizeSubtree(root: Node, locale: AppLocale): void {
  const doc = root.ownerDocument ?? document;
  if (root.nodeType === Node.TEXT_NODE) {
    const text = root as Text;
    if (!text.parentElement?.closest("script,style,code,pre,[data-no-translate]")) localizeTextNode(text, locale);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const element = root.nodeType === Node.ELEMENT_NODE ? root as Element : null;
  if (element && element.matches("script,style,code,pre,[data-no-translate]")) return;
  if (element) for (const name of observedAttributes) localizeAttribute(element, name, locale);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  while (text) {
    const node = text as Text;
    if (!node.parentElement?.closest("script,style,code,pre,[data-no-translate]")) localizeTextNode(node, locale);
    text = walker.nextNode();
  }
  if (element) {
    for (const node of element.querySelectorAll("[placeholder],[title],[aria-label],[alt]")) {
      for (const name of observedAttributes) localizeAttribute(node, name, locale);
    }
  } else {
    for (const node of doc.querySelectorAll("[placeholder],[title],[aria-label],[alt]")) {
      for (const name of observedAttributes) localizeAttribute(node, name, locale);
    }
  }
}

interface LocaleContextValue { locale: AppLocale; toggleLocale: () => void }
const LocaleContext = createContext<LocaleContextValue>({ locale: "ar", toggleLocale: () => undefined });

function initialLocale(): AppLocale {
  try { return localStorage.getItem("malabak-locale") === "en" ? "en" : "ar"; }
  catch { return "ar"; }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale);
  const value = useMemo(() => ({ locale, toggleLocale: () => setLocale((current) => {
    const next = current === "ar" ? "en" : "ar";
    try { localStorage.setItem("malabak-locale", next); } catch { /* storage can be disabled */ }
    return next;
  }) }), [locale]);

  useEffect(() => {
    const root = document.getElementById("root");
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.title = locale === "ar" ? "ملعبك — حجز وإدارة الملاعب" : "Malabak — Pitch Booking";
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = locale === "ar" ? "احجز ملعبك وأدر مواعيدك بسهولة ووضوح." : "Book a football pitch and manage schedules with clarity.";
    try { localStorage.setItem("malabak-locale", locale); } catch { /* storage can be disabled */ }
    if (!root) return;
    localizeSubtree(root, locale);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" && record.target instanceof Text) localizeTextNode(record.target, locale);
        if (record.type === "attributes" && record.target instanceof Element && record.attributeName) {
          const attribute = record.attributeName;
          if ((observedAttributes as readonly string[]).includes(attribute)) localizeAttribute(record.target, attribute, locale);
        }
        if (record.type === "childList") for (const node of record.addedNodes) localizeSubtree(node, locale);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...observedAttributes] });
    return () => observer.disconnect();
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue { return useContext(LocaleContext); }
export function isEnglishLocale(): boolean { return initialLocale() === "en"; }
export function translateText(text: string, locale: AppLocale = initialLocale()): string { return locale === "en" ? englishText(text) ?? text : text; }
