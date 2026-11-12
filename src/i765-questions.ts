// I-765 (Employment Authorization) Tier 1 questionnaire
// BronxWorks workflow: guided intake → readiness assessment → staff report
// NOTE (owner ruling D-1): applicant SELECTS eligibility category; IRU does not infer/recommend/default.

export const I765_QUESTIONS = [
  // --- Eligibility category (applicant selects — IRU does not determine) ---
  {
    id: 'i765_category', step: 'eligibility', type: 'select',
    factId: 'i765_category',
    labels: { EN: 'What is your eligibility category for employment authorization?', ES: '¿Cuál es su categoría de elegibilidad para la autorización de empleo?', ZH: '您的就业授权资格类别是什么？', HT: 'Ki kategori kalifikasyon ou pou otorizasyon travay?', AR: 'ما هي فئة أهليتك للحصول على تصريح العمل؟' },
    shortLabel: 'Eligibility category',
    shortLabels: { ES: 'Categoría de elegibilidad', ZH: '资格类别', HT: 'Kategori kalifikasyon', AR: 'فئة الأهلية' },
    options: [
      { value: 'c8', labels: { EN: '(c)(8) — Asylum application pending', ES: '(c)(8) — Solicitud de asilo pendiente', ZH: '(c)(8) — 庇护申请待决', HT: '(c)(8) — Demann azil annatant', AR: '(c)(8) — طلب اللجوء معلق' } },
      { value: 'c9', labels: { EN: '(c)(9) — Adjustment of status pending', ES: '(c)(9) — Ajuste de estatus pendiente', ZH: '(c)(9) — 身份调整待决', HT: '(c)(9) — Ajisteman estati annatant', AR: '(c)(9) — تعديل الوضع معلق' } },
      { value: 'a12', labels: { EN: '(a)(12) — Temporary Protected Status (TPS)', ES: '(a)(12) — Estatus de Protección Temporal', ZH: '(a)(12) — 临时保护身份', HT: '(a)(12) — Estati Pwoteksyon Tanporè', AR: '(a)(12) — وضع الحماية المؤقتة' } },
      { value: 'c14', labels: { EN: '(c)(14) — Deferred action (including DACA)', ES: '(c)(14) — Acción diferida (incluye DACA)', ZH: '(c)(14) — 暂缓行动（包括DACA）', HT: '(c)(14) — Aksyon difere (tankou DACA)', AR: '(c)(14) — إجراء مؤجل (بما في ذلك DACA)' } },
      { value: 'a5', labels: { EN: '(a)(5) — Asylee (granted asylum)', ES: '(a)(5) — Asilado (asilo otorgado)', ZH: '(a)(5) — 庇护获得者', HT: '(a)(5) — Moun ki jwenn azil', AR: '(a)(5) — حاصل على اللجوء' } },
      { value: 'other', labels: { EN: 'Another category (specify with staff)', ES: 'Otra categoría (especificar con el personal)', ZH: '其他类别（与工作人员确认）', HT: 'Yon lòt kategori (presize ak anplwaye)', AR: 'فئة أخرى (حدد مع الموظفين)' } },
    ],
    optionsSource: { EN: 'Per Form I-765 instructions, Part 2, Item 27', ES: 'Según las instrucciones del Formulario I-765, Parte 2, Ítem 27', ZH: '根据I-765表格说明第2部分第27项', HT: 'Dapre enstriksyon Fòm I-765, Pati 2, Atik 27', AR: 'وفقًا لتعليمات النموذج I-765، الجزء 2، البند 27' },
    helpText: { EN: 'You must choose your own eligibility category. IRU does not determine which category applies to you — if you are unsure, ask staff or consult the I-765 instructions.', ES: 'Debe elegir su propia categoría. Si no está seguro, pregunte al personal.', ZH: '您必须自己选择资格类别。如不确定，请咨询工作人员。', HT: 'Ou dwe chwazi pwòp kategori ou. Si ou pa sèten, mande anplwaye.', AR: 'يجب عليك اختيار فئة الأهلية الخاصة بك. إذا لم تكن متأكدًا، اسأل الموظفين.' },
    required: true,
  },
  {
    id: 'i765_filing_type', step: 'eligibility', type: 'radio',
    factId: 'i765_filing_type',
    labels: { EN: 'Is this your first EAD, a renewal, or a replacement?', ES: '¿Es este su primer EAD, una renovación o un reemplazo?', ZH: '这是您的第一份EAD、续签还是补发？', HT: 'Èske se premye EAD ou, yon renouvèlman, oswa yon ranplasman?', AR: 'هل هذا أول تصريح عمل لك، أم تجديد، أم بدل فاقد؟' },
    shortLabel: 'Filing type',
    shortLabels: { ES: 'Tipo de solicitud', ZH: '申请类型', HT: 'Kalite demann', AR: 'نوع الطلب' },
    options: [
      { value: 'initial', labels: { EN: 'Initial (first time)', ES: 'Inicial (primera vez)', ZH: '首次申请', HT: 'Inisyal (premye fwa)', AR: 'أولي (أول مرة)' } },
      { value: 'renewal', labels: { EN: 'Renewal', ES: 'Renovación', ZH: '续签', HT: 'Renouvèlman', AR: 'تجديد' } },
      { value: 'replacement', labels: { EN: 'Replacement (lost/stolen/damaged)', ES: 'Reemplazo (perdido/robado/dañado)', ZH: '补发（丢失/被盗/损坏）', HT: 'Ranplasman (pèdi/vòlè/domaje)', AR: 'بدل فاقد (مفقود/مسروق/تالف)' } },
    ],
    required: true,
  },
  {
    id: 'i765_prior_ead', step: 'eligibility', type: 'radio',
    factId: 'i765_prior_ead',
    labels: { EN: 'Have you had an EAD (work permit) before?', ES: '¿Ha tenido un EAD (permiso de trabajo) antes?', ZH: '您以前获得过EAD（工作许可）吗？', HT: 'Èske w te janm gen yon EAD (pèmi travay) anvan?', AR: 'هل حصلت على تصريح عمل من قبل؟' },
    shortLabel: 'Prior EAD',
    shortLabels: { ES: 'EAD anterior', ZH: '之前的EAD', HT: 'EAD anvan', AR: 'تصريح عمل سابق' },
    options: [
      { value: 'yes', labels: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' } },
      { value: 'no', labels: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' } },
    ],
    conditionalOn: { factId: 'i765_filing_type', operator: 'equals', value: 'renewal' },
  },
  // --- Personal information ---
  {
    id: 'i765_full_name', step: 'personal', type: 'text',
    factId: 'i765_full_name',
    labels: { EN: 'What is your full legal name?', ES: '¿Cuál es su nombre legal completo?', ZH: '您的全名是什么？', HT: 'Ki non legal konplè ou?', AR: 'ما هو اسمك القانوني الكامل؟' },
    shortLabel: 'Full name',
    shortLabels: { ES: 'Nombre completo', ZH: '全名', HT: 'Non konplè', AR: 'الاسم الكامل' },
    required: true,
  },
  {
    id: 'i765_dob', step: 'personal', type: 'date',
    factId: 'i765_dob',
    labels: { EN: 'What is your date of birth?', ES: '¿Cuál es su fecha de nacimiento?', ZH: '您的出生日期是什么？', HT: 'Ki dat nesans ou?', AR: 'ما هو تاريخ ميلادك؟' },
    shortLabel: 'Date of birth',
    shortLabels: { ES: 'Fecha de nacimiento', ZH: '出生日期', HT: 'Dat nesans', AR: 'تاريخ الميلاد' },
    required: true,
  },
  {
    id: 'i765_country_birth', step: 'personal', type: 'text',
    factId: 'i765_country_birth',
    labels: { EN: 'What country were you born in?', ES: '¿En qué país nació?', ZH: '您出生在哪个国家？', HT: 'Nan ki peyi ou fèt?', AR: 'في أي بلد وُلدت؟' },
    shortLabel: 'Country of birth',
    shortLabels: { ES: 'País de nacimiento', ZH: '出生国', HT: 'Peyi nesans', AR: 'بلد الميلاد' },
    required: true,
  },
  {
    id: 'i765_a_number', step: 'personal', type: 'text',
    factId: 'i765_a_number',
    labels: { EN: 'What is your A-Number? (if you have one)', ES: '¿Cuál es su Número A? (si tiene uno)', ZH: '您的A号码是多少？（如有）', HT: 'Ki Nimewo A ou? (si ou gen youn)', AR: 'ما هو رقم A الخاص بك؟ (إن وجد)' },
    shortLabel: 'A-Number',
    shortLabels: { ES: 'Número A', ZH: 'A号码', HT: 'Nimewo A', AR: 'رقم A' },
  },
  {
    id: 'i765_i94', step: 'personal', type: 'text',
    factId: 'i765_i94',
    labels: { EN: 'What is your I-94 number? (if you have one)', ES: '¿Cuál es su número I-94? (si tiene uno)', ZH: '您的I-94号码是多少？（如有）', HT: 'Ki nimewo I-94 ou? (si ou gen youn)', AR: 'ما هو رقم I-94 الخاص بك؟ (إن وجد)' },
    shortLabel: 'I-94 number',
    shortLabels: { ES: 'Número I-94', ZH: 'I-94号码', HT: 'Nimewo I-94', AR: 'رقم I-94' },
    helpText: { EN: 'Found on your I-94 arrival record. If you entered without inspection, you may not have one.', ES: 'Se encuentra en su registro de llegada I-94.', ZH: '见于您的I-94入境记录。', HT: 'Yo jwenn li sou dosye arive I-94 ou.', AR: 'موجود في سجل الوصول I-94 الخاص بك.' },
  },
  // --- Immigration history ---
  {
    id: 'i765_last_entry', step: 'history', type: 'date',
    factId: 'i765_last_entry',
    labels: { EN: 'When did you last enter the United States?', ES: '¿Cuándo ingresó por última vez a los Estados Unidos?', ZH: '您上次何时进入美国？', HT: 'Ki dènye fwa ou te antre Ozetazini?', AR: 'متى كانت آخر مرة دخلت فيها الولايات المتحدة؟' },
    shortLabel: 'Last entry date',
    shortLabels: { ES: 'Última entrada', ZH: '上次入境日期', HT: 'Dènye antre', AR: 'تاريخ آخر دخول' },
    required: true,
  },
  {
    id: 'i765_status', step: 'history', type: 'text',
    factId: 'i765_status',
    labels: { EN: 'What was your immigration status at last entry? (e.g., B-2 visitor, F-1 student, entered without inspection)', ES: '¿Cuál era su estatus migratorio en su última entrada?', ZH: '您上次入境时的移民身份是什么？', HT: 'Ki estati imigrasyon ou te gen nan dènye antre ou?', AR: 'ما كان وضعك القانوني عند آخر دخول؟' },
    shortLabel: 'Status at entry',
    shortLabels: { ES: 'Estatus al ingresar', ZH: '入境时身份', HT: 'Estati nan antre', AR: 'الوضع عند الدخول' },
    required: true,
  },
  {
    id: 'i765_current_status', step: 'history', type: 'text',
    factId: 'i765_current_status',
    labels: { EN: 'What is your current immigration status?', ES: '¿Cuál es su estatus migratorio actual?', ZH: '您目前的移民身份是什么？', HT: 'Ki estati imigrasyon ou kounye a?', AR: 'ما هو وضعك القانوني الحالي؟' },
    shortLabel: 'Current status',
    shortLabels: { ES: 'Estatus actual', ZH: '当前身份', HT: 'Estati aktyèl', AR: 'الوضع الحالي' },
    required: true,
  },
];

export const I765_STEPS = [
  { id: 'eligibility', title: { EN: 'Eligibility', ES: 'Elegibilidad', ZH: '资格', HT: 'Kalifikasyon', AR: 'الأهلية' } },
  { id: 'personal', title: { EN: 'Personal Information', ES: 'Información personal', ZH: '个人信息', HT: 'Enfòmasyon pèsonèl', AR: 'المعلومات الشخصية' } },
  { id: 'history', title: { EN: 'Immigration History', ES: 'Historial migratorio', ZH: '移民历史', HT: 'Istorik imigrasyon', AR: 'سجل الهجرة' } },
];

export const I765_FORM_INFO = {
  formNumber: 'I-765',
  title: 'Application for Employment Authorization',
  titles: { ES: 'Solicitud de autorización de empleo', ZH: '就业授权申请', HT: 'Demann Otorizasyon Travay', AR: 'طلب تصريح العمل' },
  edition: '08/21/25',
  pdfUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-765.pdf',
  instructionsUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-765instr.pdf',
  fillable: false,
};
