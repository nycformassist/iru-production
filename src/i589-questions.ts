// I-589 (Asylum) Tier 1 questionnaire — extracted from production IRU logic
// BronxWorks workflow: guided intake → readiness assessment → staff report
// PDF field mapping: fillable — answers fill the I-589 AcroForm PDF via
// api/fill.py (i589_full_binder) and Tier1Flow generateCompletedForm
// ('Generate completed I-589').

export const I589_QUESTIONS = [
  // --- Eligibility: one-year filing deadline ---
  {
    id: 'i589_entry_date', step: 'eligibility', type: 'date',
    factId: 'i589_entry_date',
    labels: { EN: 'When did you most recently enter the United States?', ES: '¿Cuándo ingresó más recientemente a los Estados Unidos?', ZH: '您最近一次何时进入美国？', HT: 'Ki dènye fwa ou te antre Ozetazini?', AR: 'متى كانت آخر مرة دخلت فيها الولايات المتحدة؟' },
    shortLabel: 'Entry date',
    shortLabels: { ES: 'Fecha de entrada', ZH: '入境日期', HT: 'Dat antre', AR: 'تاريخ الدخول' },
    helpText: { EN: 'Asylum must generally be filed within one year of your last arrival. This date determines whether you meet the deadline.', ES: 'El asilo generalmente debe solicitarse dentro de un año de su última llegada.', ZH: '庇护通常必须在您最后一次入境后一年内申请。', HT: 'Azil dwe jeneralman depoze nan yon ane apre dènye arive ou.', AR: 'يجب تقديم طلب اللجوء عمومًا خلال عام واحد من آخر وصول لك.' },
    required: true,
  },
  {
    id: 'i589_entry_manner', step: 'eligibility', type: 'radio',
    factId: 'i589_entry_manner',
    labels: { EN: 'How did you enter the United States?', ES: '¿Cómo ingresó a los Estados Unidos?', ZH: '您是如何进入美国的？', HT: 'Kijan ou te antre Ozetazini?', AR: 'كيف دخلت الولايات المتحدة؟' },
    shortLabel: 'Manner of entry',
    shortLabels: { ES: 'Forma de entrada', ZH: '入境方式', HT: 'Fason antre', AR: 'طريقة الدخول' },
    options: [
      { value: 'inspected', labels: { EN: 'Inspected at a port of entry (with visa or parole)', ES: 'Inspeccionado en un puerto de entrada', ZH: '在入境口岸接受检查', HT: 'Enspekte nan yon pò antre', AR: 'تم التفتيش في منفذ الدخول' } },
      { value: 'uninspected', labels: { EN: 'Entered without inspection', ES: 'Entró sin inspección', ZH: '未经检查入境', HT: 'Antre san enspeksyon', AR: 'دخلت دون تفتيش' } },
      { value: 'unsure', labels: { EN: 'Not sure', ES: 'No estoy seguro', ZH: '不确定', HT: 'Mwen pa sèten', AR: 'لست متأكدًا' } },
    ],
    helpText: { EN: 'Manner of entry affects eligibility for asylum and other relief. Answer honestly — staff will help assess your options.', ES: 'La forma de entrada afecta la elegibilidad.', ZH: '入境方式影响庇护和其他救济的资格。', HT: 'Fason ou te antre afekte kalifikasyon pou azil.', AR: 'تؤثر طريقة الدخول على الأهلية للحصول على اللجوء.' },
    required: true,
  },
  // --- Personal information ---
  {
    id: 'i589_full_name', step: 'personal', type: 'text',
    factId: 'i589_full_name',
    labels: { EN: 'What is your full legal name?', ES: '¿Cuál es su nombre legal completo?', ZH: '您的全名是什么？', HT: 'Ki non legal konplè ou?', AR: 'ما هو اسمك القانوني الكامل؟' },
    shortLabel: 'Full name',
    shortLabels: { ES: 'Nombre completo', ZH: '全名', HT: 'Non konplè', AR: 'الاسم الكامل' },
    required: true,
  },
  {
    id: 'i589_dob', step: 'personal', type: 'date',
    factId: 'i589_dob',
    labels: { EN: 'What is your date of birth?', ES: '¿Cuál es su fecha de nacimiento?', ZH: '您的出生日期是什么？', HT: 'Ki dat nesans ou?', AR: 'ما هو تاريخ ميلادك؟' },
    shortLabel: 'Date of birth',
    shortLabels: { ES: 'Fecha de nacimiento', ZH: '出生日期', HT: 'Dat nesans', AR: 'تاريخ الميلاد' },
    required: true,
  },
  {
    id: 'i589_country_origin', step: 'personal', type: 'text',
    factId: 'i589_country_origin',
    labels: { EN: 'What is your country of origin (nationality)?', ES: '¿Cuál es su país de origen?', ZH: '您的原籍国是哪里？', HT: 'Ki peyi orijin ou?', AR: 'ما هو بلدك الأصلي؟' },
    shortLabel: 'Country of origin',
    shortLabels: { ES: 'País de origen', ZH: '原籍国', HT: 'Peyi orijin', AR: 'بلد المنشأ' },
    required: true,
  },
  {
    id: 'i589_a_number', step: 'personal', type: 'text',
    factId: 'i589_a_number',
    labels: { EN: 'What is your A-Number? (if you have one)', ES: '¿Cuál es su Número A? (si tiene uno)', ZH: '您的A号码是多少？（如有）', HT: 'Ki Nimewo A ou? (si ou gen youn)', AR: 'ما هو رقم A الخاص بك؟ (إن وجد)' },
    shortLabel: 'A-Number',
    shortLabels: { ES: 'Número A', ZH: 'A号码', HT: 'Nimewo A', AR: 'رقم A' },
    helpText: { EN: 'Found on immigration documents. If you do not have one yet, leave blank.', ES: 'Se encuentra en documentos de inmigración.', ZH: '见于移民文件。如尚未获得，请留空。', HT: 'Yo jwenn li sou dokiman imigrasyon.', AR: 'موجود في مستندات الهجرة.' },
  },
  // --- Asylum basis ---
  {
    id: 'i589_persecution_grounds', step: 'basis', type: 'select',
    factId: 'i589_persecution_grounds',
    labels: { EN: 'What is the basis of your fear of persecution?', ES: '¿Cuál es la base de su temor de persecución?', ZH: '您害怕受到迫害的依据是什么？', HT: 'Ki baz krent pèsekisyon ou?', AR: 'ما هو أساس خوفك من الاضطهاد؟' },
    shortLabel: 'Persecution grounds',
    shortLabels: { ES: 'Motivos de persecución', ZH: '迫害依据', HT: 'Baz pèsekisyon', AR: 'أسباب الاضطهاد' },
    options: [
      { value: 'race', labels: { EN: 'Race', ES: 'Raza', ZH: '种族', HT: 'Ras', AR: 'العرق' } },
      { value: 'religion', labels: { EN: 'Religion', ES: 'Religión', ZH: '宗教', HT: 'Relijyon', AR: 'الدين' } },
      { value: 'nationality', labels: { EN: 'Nationality', ES: 'Nacionalidad', ZH: '国籍', HT: 'Nasyonalite', AR: 'الجنسية' } },
      { value: 'political', labels: { EN: 'Political opinion', ES: 'Opinión política', ZH: '政治观点', HT: 'Opinyon politik', AR: 'الرأي السياسي' } },
      { value: 'social_group', labels: { EN: 'Membership in a particular social group', ES: 'Pertenencia a un grupo social particular', ZH: '特定社会团体成员', HT: 'Manm yon gwoup sosyal patikilye', AR: 'عضوية في فئة اجتماعية معينة' } },
    ],
    optionsSource: { EN: 'Per Form I-589 instructions, Part B', ES: 'Según las instrucciones del Formulario I-589, Parte B', ZH: '根据I-589表格说明B部分', HT: 'Dapre enstriksyon Fòm I-589, Pati B', AR: 'وفقًا لتعليمات النموذج I-589، الجزء ب' },
    helpText: { EN: 'Asylum requires showing persecution on account of one of these five protected grounds. Staff can help you identify which applies.', ES: 'El asilo requiere demostrar persecución por uno de estos motivos.', ZH: '庇护需要证明基于这五个受保护理由之一受到迫害。', HT: 'Azil mande pou montre pèsekisyon akoz youn nan senk rezon pwoteje sa yo.', AR: 'يتطلب اللجوء إظهار الاضطهاد بسبب أحد هذه الأسباب الخمسة المحمية.' },
    required: true,
  },
  {
    id: 'i589_has_evidence', step: 'basis', type: 'radio',
    factId: 'i589_has_evidence',
    labels: { EN: 'Do you have evidence of persecution (photos, police reports, threats, medical records)?', ES: '¿Tiene evidencia de persecución?', ZH: '您有受迫害的证据吗？', HT: 'Èske w gen prèv pèsekisyon?', AR: 'هل لديك أدلة على الاضطهاد؟' },
    shortLabel: 'Persecution evidence',
    shortLabels: { ES: 'Evidencia de persecución', ZH: '迫害证据', HT: 'Prèv pèsekisyon', AR: 'أدلة الاضطهاد' },
    options: [
      { value: 'yes', labels: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' } },
      { value: 'no', labels: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' } },
    ],
    helpText: { EN: 'Evidence strengthens an asylum claim significantly. If you do not have evidence yet, staff can advise on what to gather.', ES: 'La evidencia fortalece significativamente una solicitud de asilo.', ZH: '证据可显著加强庇护申请。', HT: 'Prèv ranfòse yon reklamasyon azil anpil.', AR: 'الأدلة تقوي طلب اللجوء بشكل كبير.' },
  },
  // --- Family (derivative asylum) ---
  {
    id: 'i589_marital_status', step: 'family', type: 'radio',
    factId: 'i589_marital_status',
    labels: { EN: 'What is your marital status?', ES: '¿Cuál es su estado civil?', ZH: '您的婚姻状况是什么？', HT: 'Ki eta sivil ou?', AR: 'ما هي حالتك الاجتماعية؟' },
    shortLabel: 'Marital status',
    shortLabels: { ES: 'Estado civil', ZH: '婚姻状况', HT: 'Eta sivil', AR: 'الحالة الاجتماعية' },
    options: [
      { value: 'single', labels: { EN: 'Single', ES: 'Soltero/a', ZH: '单身', HT: 'Selibatè', AR: 'أعزب' } },
      { value: 'married', labels: { EN: 'Married', ES: 'Casado/a', ZH: '已婚', HT: 'Marye', AR: 'متزوج' } },
      { value: 'divorced', labels: { EN: 'Divorced', ES: 'Divorciado/a', ZH: '离异', HT: 'Divòse', AR: 'مطلق' } },
      { value: 'widowed', labels: { EN: 'Widowed', ES: 'Viudo/a', ZH: '丧偶', HT: 'Vèf', AR: 'أرمل' } },
    ],
  },
  {
    id: 'i589_has_children', step: 'family', type: 'radio',
    factId: 'i589_has_children',
    labels: { EN: 'Do you have children under 21?', ES: '¿Tiene hijos menores de 21 años?', ZH: '您有21岁以下的子女吗？', HT: 'Èske w gen timoun ki poko gen 21 an?', AR: 'هل لديك أطفال دون سن 21؟' },
    shortLabel: 'Children under 21',
    shortLabels: { ES: 'Hijos menores de 21', ZH: '21岁以下子女', HT: 'Timoun mwens ke 21 an', AR: 'أطفال دون 21' },
    options: [
      { value: 'yes', labels: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' } },
      { value: 'no', labels: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' } },
    ],
    helpText: { EN: 'A spouse and unmarried children under 21 may be included as derivatives on your asylum application.', ES: 'Un cónyuge e hijos solteros menores de 21 años pueden incluirse como derivados.', ZH: '配偶和21岁以下未婚子女可作为附带申请人包含在您的庇护申请中。', HT: 'Yon mari/madanm ak timoun ki poko marye ki poko gen 21 an ka enkli kòm derivatif.', AR: 'يمكن إدراج الزوج والأبناء غير المتزوجين دون 21 عامًا كمشتقين في طلب اللجوء الخاص بك.' },
  },
  {
    id: 'i589_children', step: 'family', type: 'repeating_group',
    factId: 'i589_children',
    groupId: 'children',
    labels: { EN: 'List your children under 21', ES: 'Enumere a sus hijos menores de 21 años', ZH: '列出您21岁以下的子女', HT: 'Lis timoun ou yo ki poko gen 21 an', AR: 'اذكر أطفالك دون سن 21' },
    shortLabel: 'Children',
    shortLabels: { ES: 'Hijos', ZH: '子女', HT: 'Timoun', AR: 'الأطفال' },
    conditionalOn: { factId: 'i589_has_children', operator: 'equals', value: 'yes' },
  },
  // --- Filing history ---
  {
    id: 'i589_prior_filing', step: 'history', type: 'radio',
    factId: 'i589_prior_filing',
    labels: { EN: 'Have you ever filed for asylum before?', ES: '¿Ha solicitado asilo anteriormente?', ZH: '您以前申请过庇护吗？', HT: 'Èske w te janm depoze pou azil anvan?', AR: 'هل سبق لك أن تقدمت بطلب لجوء من قبل؟' },
    shortLabel: 'Prior asylum filing',
    shortLabels: { ES: 'Solicitud previa de asilo', ZH: '之前的庇护申请', HT: 'Demann azil anvan', AR: 'طلب لجوء سابق' },
    options: [
      { value: 'yes', labels: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' } },
      { value: 'no', labels: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' } },
    ],
    helpText: { EN: 'A prior denial may affect your current filing. Disclose this to staff so they can advise you.', ES: 'Una denegación previa puede afectar su solicitud actual.', ZH: '之前的拒绝可能影响您当前的申请。', HT: 'Yon refi anvan ka afekte depo aktyèl ou.', AR: 'قد يؤثر الرفض السابق على طلبك الحالي.' },
  },
  {
    id: 'i589_in_proceedings', step: 'history', type: 'radio',
    factId: 'i589_in_proceedings',
    labels: { EN: 'Are you currently in removal (deportation) proceedings?', ES: '¿Está actualmente en proceso de deportación?', ZH: '您目前是否处于递解程序中？', HT: 'Èske w nan pwosedi depòtasyon kounye a?', AR: 'هل أنت حاليًا في إجراءات الترحيل؟' },
    shortLabel: 'In proceedings',
    shortLabels: { ES: 'En proceso', ZH: '处于程序中', HT: 'Nan pwosedi', AR: 'في الإجراءات' },
    options: [
      { value: 'yes', labels: { EN: 'Yes', ES: 'Sí', ZH: '是', HT: 'Wi', AR: 'نعم' } },
      { value: 'no', labels: { EN: 'No', ES: 'No', ZH: '否', HT: 'Non', AR: 'لا' } },
      { value: 'unsure', labels: { EN: 'Not sure', ES: 'No estoy seguro', ZH: '不确定', HT: 'Mwen pa sèten', AR: 'لست متأكدًا' } },
    ],
    helpText: { EN: 'If you are in proceedings, your asylum application is filed with the immigration court, not USCIS. Staff need to know this.', ES: 'Si está en proceso, su solicitud se presenta ante el tribunal de inmigración.', ZH: '如果您处于程序中，您的庇护申请将提交给移民法庭，而非USCIS。', HT: 'Si w nan pwosedi, demann azil ou depoze nan tribinal imigrasyon.', AR: 'إذا كنت في الإجراءات، يتم تقديم طلب اللجوء الخاص بك إلى محكمة الهجرة.' },
  },
];

export const I589_STEPS = [
  { id: 'eligibility', title: { EN: 'Eligibility', ES: 'Elegibilidad', ZH: '资格', HT: 'Kalifikasyon', AR: 'الأهلية' } },
  { id: 'personal', title: { EN: 'Personal Information', ES: 'Información personal', ZH: '个人信息', HT: 'Enfòmasyon pèsonèl', AR: 'المعلومات الشخصية' } },
  { id: 'basis', title: { EN: 'Basis for Asylum', ES: 'Base para el asilo', ZH: '庇护依据', HT: 'Baz pou azil', AR: 'أساس اللجوء' } },
  { id: 'family', title: { EN: 'Family', ES: 'Familia', ZH: '家庭', HT: 'Fanmi', AR: 'العائلة' } },
  { id: 'history', title: { EN: 'Filing History', ES: 'Historial de solicitudes', ZH: '申请历史', HT: 'Istorik demann', AR: 'سجل الطلبات' } },
];

export const I589_FORM_INFO = {
  formNumber: 'I-589',
  title: 'Application for Asylum and for Withholding of Removal',
  titles: { ES: 'Solicitud de asilo y de suspensión de expulsión', ZH: '庇护和暂缓递解申请', HT: 'Demann Azil ak pou Anpeche Depòtasyon', AR: 'طلب اللجوء ووقف الترحيل' },
  edition: '07/28/26',
  pdfUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-589.pdf',
  instructionsUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-589instr.pdf',
  fillable: true,
};
