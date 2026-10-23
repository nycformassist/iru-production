/**
 * lib/forms/registry.js — Versioned official-form registry (directive §7.1).
 *
 * Every mapping below was verified against the official USCIS PDF stored
 * in forms/templates/ (see forms/PROVENANCE.md): field names extracted
 * from the AcroForm, and checkbox indices verified against widget
 * positions vs. printed labels (the two forms order checkbox indices
 * DIFFERENTLY — never guess these).
 *
 * Integrity rules:
 * - Signature, date-of-signature, preparer-signature and interpreter-
 *   signature fields are NEVER mapped. generate-form.js enforces a
 *   denylist on top of this registry.
 * - Fields IRU cannot map reliably stay unmapped and are listed in
 *   `consumerCompletedSections` so the completion summary is honest
 *   about what the consumer must still do themselves.
 * - Narrative (I-589 Part B) is the consumer's own account. IRU does not
 *   auto-fill it in this version; the consumer's narrative fact is
 *   surfaced in the completion summary for them to use.
 */

export const FORM_REGISTRY_VERSION = 1;
export const REGISTRY_CHECKED_DATE = '2026-10-23';

const S589 = 'form1[0].#subform[0]';
const S765_1 = 'form1[0].Page1[0]';
const S765_2 = 'form1[0].Page2[0]';
const S765_3 = 'form1[0].Page3[0]';

export const FORM_REGISTRY = [
  {
    id: 'I-589',
    name: 'Form I-589, Application for Asylum and for Withholding of Removal',
    editionDate: '07/28/26',
    editionNote:
      'Edition printed on the PDF USCIS serves (retrieved 2026-10-21; re-verified against the USCIS monitor baseline 2026-10-23). The I-589 web page listed 01/20/25 as the current edition until 2026-10-22, when it moved to 07/28/26 — the page now matches the served PDF. USCIS also accepts editions 01/20/25 and 09/03/24.',
    sourceUrl: 'https://www.uscis.gov/i-589',
    pdfUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-589.pdf',
    instructionsUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-589instr.pdf',
    templateFile: 'i-589.pdf',
    pages: 12,
    checkedDate: REGISTRY_CHECKED_DATE,
    applicability:
      'For people in the United States applying for asylum or withholding of removal. The consumer chooses this form; IRU does not determine eligibility.',
    applicabilityI18n: {
      ES: 'Para personas en los Estados Unidos que solicitan asilo o suspensión de deportación. El consumidor elige este formulario; IRU no determina la elegibilidad.',
      ZH: '适用于在美国申请庇护或暂缓遣返的人。由消费者选择此表格；IRU 不决定资格。',
      HT: 'Pou moun Ozetazini k ap aplike pou azil oswa sispansyon depòtasyon. Konsomatè a chwazi fòm sa a; IRU pa detèmine elijibilite.',
      AR: 'للأشخاص في الولايات المتحدة المتقدمين بطلب اللجوء أو وقف الترحيل. يختار المستهلك هذا النموذج؛ لا تحدد IRU الأهلية.',
    },
    fields: [
      { pdfField: `${S589}.PtAILine1_ANumber[0]`, factId: 'a_number', required: false, transform: 'aNumber', label: 'A-Number (Part A.I, Item 1)' },
      { pdfField: `${S589}.PtAILine4_LastName[0]`, factId: 'family_name', required: true, label: 'Complete last name (Item 4)', question: 'What is your complete last (family) name?' },
      { pdfField: `${S589}.PtAILine5_FirstName[0]`, factId: 'given_name', required: true, label: 'First name (Item 5)', question: 'What is your first (given) name?' },
      { pdfField: `${S589}.PtAILine6_MiddleName[0]`, factId: 'middle_name', required: false, label: 'Middle name (Item 6)' },
      { pdfField: `${S589}.TextField1[1]`, factId: 'other_names_used', required: false, label: 'Other names used (Item 7)' },
      { pdfField: `${S589}.PtAILine8_StreetNumandName[0]`, factId: 'residence_street', required: true, label: 'U.S. residence street (Item 8)', question: 'What is the street address where you physically reside in the U.S.?' },
      { pdfField: `${S589}.TextField1[2]`, factId: 'residence_city', required: true, label: 'U.S. residence city (Item 8)', question: 'In which U.S. city do you reside?' },
      { pdfField: `${S589}.PtAILine8_State[0]`, factId: 'residence_region', required: true, label: 'U.S. residence state (Item 8)', question: 'In which U.S. state do you reside?' },
      { pdfField: `${S589}.PtAILine8_Zipcode[0]`, factId: 'residence_postal_code', required: true, label: 'U.S. residence ZIP code (Item 8)', question: 'What is your U.S. ZIP code?' },
      { pdfField: `${S589}.PtAILine8_AreaCode[0]`, factId: 'phone', required: false, kind: 'text', transform: 'phoneAreaCode', label: 'Residence telephone — area code (Item 8)' },
      { pdfField: `${S589}.PtAILine8_TelephoneNumber[0]`, factId: 'phone', required: false, transform: 'phoneNumber', label: 'Residence telephone number (Item 8)' },
      { pdfField: `${S589}.PtAILine9_StreetNumandName[0]`, factId: 'mailing_street', required: false, label: 'Mailing street (Item 9, if different)' },
      { pdfField: `${S589}.PtAILine9_City[0]`, factId: 'mailing_city', required: false, label: 'Mailing city (Item 9)' },
      { pdfField: `${S589}.PtAILine9_State[0]`, factId: 'mailing_region', required: false, label: 'Mailing state (Item 9)' },
      { pdfField: `${S589}.PtAILine9_ZipCode[0]`, factId: 'mailing_postal_code', required: false, label: 'Mailing ZIP code (Item 9)' },
      // Sex — indices verified positionally 2026-10-21: [0]=Male, [1]=Female.
      { pdfField: `${S589}.PartALine9Sex[0]`, factId: 'gender', required: true, kind: 'checkbox', matchValue: 'male', label: 'Sex — Male (Item 10)', question: 'What is your sex as it should appear on the form (Male/Female)?' },
      { pdfField: `${S589}.PartALine9Sex[1]`, factId: 'gender', required: true, kind: 'checkbox', matchValue: 'female', label: 'Sex — Female (Item 10)' },
      // Marital — indices verified positionally: [0]=Single [1]=Married [2]=Divorced [3]=Widowed.
      { pdfField: `${S589}.Marital[0]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'single', label: 'Marital status — Single (Item 11)', question: 'What is your marital status?' },
      { pdfField: `${S589}.Marital[1]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'married', label: 'Marital status — Married (Item 11)' },
      { pdfField: `${S589}.Marital[2]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'divorced', label: 'Marital status — Divorced (Item 11)' },
      { pdfField: `${S589}.Marital[3]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'widowed', label: 'Marital status — Widowed (Item 11)' },
      { pdfField: `${S589}.DateTimeField1[0]`, factId: 'date_of_birth', required: true, transform: 'dateMDY', label: 'Date of birth (Item 12)', question: 'What is your date of birth?' },
      { pdfField: `${S589}.TextField1[4]`, factId: 'city_of_birth', required: true, transform: 'cityCountryOfBirth', label: 'City and country of birth (Item 13)', question: 'In which city and country were you born?' },
      { pdfField: `${S589}.TextField1[3]`, factId: 'citizenship', required: true, label: 'Present nationality / citizenship (Item 14)', question: 'What is your present nationality (citizenship)?' },
      { pdfField: `${S589}.TextField1[5]`, factId: 'nationality', required: false, label: 'Nationality at birth (Item 15)' },
      { pdfField: `${S589}.TextField5[0]`, factId: 'passport_country', required: false, label: 'Country that issued last passport (Item 20)' },
      { pdfField: `${S589}.TextField5[1]`, factId: 'passport_number', required: false, label: 'Passport number (Item 21)' },
      { pdfField: `${S589}.DateTimeField2[0]`, factId: 'entry_date', required: false, transform: 'dateMDY', label: 'Most recent entry date (Item 19.c, first row)' },
    ],
    consumerCompletedSections: [
      'Part A.I Items 2–3 (SSN / USCIS online account — IRU does not collect these for this form)',
      'Part A.I Item 18 (immigration-court proceedings — your own attestation)',
      'Part A.I Items 19.a–19.b and the rest of the entry table (I-94 number, place/status of each entry)',
      'Part A.I Items 16–17 and 22–25 (race/ethnic group, religion, passport expiration, languages)',
      'Part A.II (spouse and children information)',
      'Part B (your personal statement — this must be your own account, in your own words)',
      'Part C (additional information), Part D (your signature — IRU never signs), Parts E–G (interpreter / preparer / attorney declarations)',
    ],
  },
  {
    id: 'I-765',
    name: 'Form I-765, Application for Employment Authorization',
    editionDate: '08/21/25',
    editionNote: 'Edition printed on the PDF USCIS serves (retrieved and verified 2026-10-21).',
    sourceUrl: 'https://www.uscis.gov/i-765',
    pdfUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-765.pdf',
    instructionsUrl: 'https://www.uscis.gov/sites/default/files/document/forms/i-765instr.pdf',
    templateFile: 'i-765.pdf',
    pages: 7,
    checkedDate: REGISTRY_CHECKED_DATE,
    applicability:
      'For people in the United States applying for an Employment Authorization Document (work permit) in an eligibility category they select. The consumer chooses this form and category; IRU does not determine eligibility.',
    applicabilityI18n: {
      ES: 'Para personas en los Estados Unidos que solicitan un Documento de Autorización de Empleo (permiso de trabajo) en una categoría de elegibilidad que ellos seleccionan. El consumidor elige este formulario y categoría; IRU no determina la elegibilidad.',
      ZH: '适用于在美国申请就业授权文件（工作许可）的人，类别由其自行选择。由消费者选择此表格和类别；IRU 不决定资格。',
      HT: 'Pou moun Ozetazini k ap aplike pou yon Dokiman Otorizasyon Travay (pèmi travay) nan yon kategori elijibilite yo chwazi. Konsomatè a chwazi fòm sa a ak kategori a; IRU pa detèmine elijibilite.',
      AR: 'للأشخاص في الولايات المتحدة المتقدمين بطلب وثيقة تصريح عمل (تصريح عمل) في فئة أهلية يختارونها. يختار المستهلك هذا النموذج والفئة؛ لا تحدد IRU الأهلية.',
    },
    fields: [
      // Reason for applying — indices per form order: [0]=1.a initial, [1]=1.b replacement, [2]=1.c renewal.
      { pdfField: `${S765_1}.Part1_Checkbox[0]`, factId: 'application_reason', required: true, kind: 'checkbox', matchValue: 'initial', label: 'Reason — initial permission to accept employment (Part 1, 1.a)', question: 'Is this an initial application, a replacement, or a renewal?' },
      { pdfField: `${S765_1}.Part1_Checkbox[1]`, factId: 'application_reason', required: true, kind: 'checkbox', matchValue: 'replacement', label: 'Reason — replacement of lost/stolen/damaged EAD (1.b)' },
      { pdfField: `${S765_1}.Part1_Checkbox[2]`, factId: 'application_reason', required: true, kind: 'checkbox', matchValue: 'renewal', label: 'Reason — renewal of permission to accept employment (1.c)' },
      { pdfField: `${S765_1}.Line1a_FamilyName[0]`, factId: 'family_name', required: true, label: 'Your full legal name — family name (Item 1.a)', question: 'What is your family (last) name?' },
      { pdfField: `${S765_1}.Line1b_GivenName[0]`, factId: 'given_name', required: true, label: 'Given name (Item 1.b)', question: 'What is your given (first) name?' },
      { pdfField: `${S765_1}.Line1c_MiddleName[0]`, factId: 'middle_name', required: false, label: 'Middle name (Item 1.c)' },
      { pdfField: `${S765_1}.Line2a_FamilyName[0]`, factId: 'other_family_name', required: false, label: 'Other family name used (Item 2.a)' },
      { pdfField: `${S765_1}.Line2b_GivenName[0]`, factId: 'other_given_name', required: false, label: 'Other given name used (Item 2.b)' },
      { pdfField: `${S765_2}.Line4b_StreetNumberName[0]`, factId: 'mailing_street', required: true, label: 'U.S. mailing address — street (Item 4.b)', question: 'What is your U.S. mailing address?' },
      { pdfField: `${S765_2}.Pt2Line5_CityOrTown[0]`, factId: 'mailing_city', required: true, label: 'Mailing city or town (Item 5)', question: 'Mailing address city?' },
      { pdfField: `${S765_2}.Pt2Line5_State[0]`, factId: 'mailing_region', required: true, label: 'Mailing state (Item 5)', question: 'Mailing address state?' },
      { pdfField: `${S765_2}.Pt2Line5_ZipCode[0]`, factId: 'mailing_postal_code', required: true, label: 'Mailing ZIP code (Item 5)', question: 'Mailing address ZIP code?' },
      { pdfField: `${S765_2}.Pt2Line7_StreetNumberName[0]`, factId: 'residence_street', required: false, label: 'Physical address — street (Item 7)', question: '' },
      { pdfField: `${S765_2}.Pt2Line7_CityOrTown[0]`, factId: 'residence_city', required: false, label: 'Physical address — city (Item 7)' },
      { pdfField: `${S765_2}.Pt2Line7_State[0]`, factId: 'residence_region', required: false, label: 'Physical address — state (Item 7)' },
      { pdfField: `${S765_2}.Pt2Line7_ZipCode[0]`, factId: 'residence_postal_code', required: false, label: 'Physical address — ZIP code (Item 7)' },
      { pdfField: `${S765_2}.Line7_AlienNumber[0]`, factId: 'a_number', required: false, transform: 'aNumber', label: 'A-Number (Item 8)' },
      // Sex — indices verified positionally 2026-10-21: [0]=Female, [1]=Male (differs from I-589!).
      { pdfField: `${S765_2}.Line9_Checkbox[1]`, factId: 'gender', required: true, kind: 'checkbox', matchValue: 'male', label: 'Sex — Male (Item 9)', question: 'What is your sex as it should appear on the form (Male/Female)?' },
      { pdfField: `${S765_2}.Line9_Checkbox[0]`, factId: 'gender', required: true, kind: 'checkbox', matchValue: 'female', label: 'Sex — Female (Item 9)' },
      // Marital — indices verified positionally: [0]=Widowed [1]=Divorced [2]=Single [3]=Married.
      { pdfField: `${S765_2}.Line10_Checkbox[2]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'single', label: 'Marital status — Single (Item 10)', question: 'What is your marital status?' },
      { pdfField: `${S765_2}.Line10_Checkbox[3]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'married', label: 'Marital status — Married (Item 10)' },
      { pdfField: `${S765_2}.Line10_Checkbox[1]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'divorced', label: 'Marital status — Divorced (Item 10)' },
      { pdfField: `${S765_2}.Line10_Checkbox[0]`, factId: 'marital_status', required: true, kind: 'checkbox', matchValue: 'widowed', label: 'Marital status — Widowed (Item 10)' },
      { pdfField: `${S765_2}.Line12b_SSN[0]`, factId: 'ssn', required: false, label: 'Social Security number (Item 12.b, if one was issued to you)' },
      { pdfField: `${S765_2}.Line17a_CountryOfBirth[0]`, factId: 'citizenship', required: true, label: 'Country of citizenship or nationality (Item 17.a)', question: 'What is your country of citizenship or nationality?' },
      { pdfField: `${S765_3}.Line18a_CityTownOfBirth[0]`, factId: 'city_of_birth', required: true, label: 'City or town of birth (Item 18.a)', question: 'In which city or town were you born?' },
      { pdfField: `${S765_3}.Line18c_CountryOfBirth[0]`, factId: 'country_of_birth', required: true, label: 'Country of birth (Item 18.c)', question: 'In which country were you born?' },
      { pdfField: `${S765_3}.Line19_DOB[0]`, factId: 'date_of_birth', required: true, transform: 'dateMDY', label: 'Date of birth (Item 19)', question: 'What is your date of birth?' },
      { pdfField: `${S765_3}.Line20b_Passport[0]`, factId: 'passport_number', required: false, label: 'Passport number (Item 20.b)' },
      { pdfField: `${S765_3}.Line20d_CountryOfIssuance[0]`, factId: 'passport_country', required: false, label: 'Passport country of issuance (Item 20.d)' },
      { pdfField: `${S765_3}.Line21_DateOfLastEntry[0]`, factId: 'entry_date', required: false, transform: 'dateMDY', label: 'Date of last entry into the U.S. (Item 21)' },
      { pdfField: `${S765_3}.place_entry[0]`, factId: 'entry_place', required: false, label: 'Place of last entry into the U.S. (Item 22)' },
      { pdfField: `${S765_3}.Line24_CurrentStatus[0]`, factId: 'current_status', required: false, label: 'Current immigration status or category (Item 24)' },
    ],
    consumerCompletedSections: [
      'Part 2, Item 27 (eligibility category) — the category is a legal determination input you must choose yourself; IRU records your choice in the completion summary but does not print it into the category boxes in this version',
      'Part 2, Items 11–16 (prior I-765 filings and Social Security card consent questions — your own answers)',
      'Part 2, Items 20.a, 20.c, 20.e, 23, 25–26, 28–31 (I-94 number, travel document, status at last entry, category-specific items)',
      'Part 3 (your certification and signature — IRU never signs), Part 4 (interpreter), Part 5 (preparer), Part 6 (additional information)',
    ],
  },
];

export function getFormEntry(formId) {
  return FORM_REGISTRY.find((f) => f.id === formId) || null;
}

/**
 * Localized missing-information questions (language-continuity
 * directive 2026-10-22). The registry `question` on each field is the
 * English prompt that explains what the OFFICIAL form item asks for;
 * these are the same explanations in the applicant's language. Field
 * `label`s are NOT translated — they name official form items.
 * Keyed by form id, then fact id (the question lives on the first
 * field for each fact; later same-fact fields carry no question).
 */
export const FIELD_QUESTION_I18N = {
  'I-589': {
    family_name: { ES: '¿Cuál es su apellido completo?', ZH: '您的完整姓氏是什么？', HT: 'Ki non fanmi konplè ou?', AR: 'ما هو اسم عائلتك الكامل؟' },
    given_name: { ES: '¿Cuál es su primer nombre?', ZH: '您的名字是什么？', HT: 'Ki prenon ou?', AR: 'ما هو اسمك الأول؟' },
    residence_street: { ES: '¿Cuál es la dirección donde reside físicamente en EE. UU.?', ZH: '您在美国实际居住的街道地址是什么？', HT: 'Ki adrès ri kote ou rete fizikman Ozetazini?', AR: 'ما هو عنوان الشارع الذي تقيم فيه فعليًا في الولايات المتحدة؟' },
    residence_city: { ES: '¿En qué ciudad de EE. UU. reside?', ZH: '您居住在美国哪个城市？', HT: 'Nan ki vil Ozetazini ou rete?', AR: 'في أي مدينة أمريكية تقيم؟' },
    residence_region: { ES: '¿En qué estado de EE. UU. reside?', ZH: '您居住在美国哪个州？', HT: 'Nan ki eta Ozetazini ou rete?', AR: 'في أي ولاية أمريكية تقيم؟' },
    residence_postal_code: { ES: '¿Cuál es su código postal de EE. UU.?', ZH: '您的美国邮政编码是什么？', HT: 'Ki kòd postal Etazini ou?', AR: 'ما هو الرمز البريدي الأمريكي الخاص بك؟' },
    gender: { ES: '¿Cuál es su sexo tal como debe aparecer en el formulario (Masculino/Femenino)?', ZH: '您的性别是什么，应如表格所示（男/女）？', HT: 'Ki sèks ou jan li dwe parèt sou fòm nan (Gason/Fi)?', AR: 'ما هو جنسك كما يجب أن يظهر في النموذج (ذكر/أنثى)؟' },
    marital_status: { ES: '¿Cuál es su estado civil?', ZH: '您的婚姻状况是什么？', HT: 'Ki eta sivil ou?', AR: 'ما هي حالتك الاجتماعية؟' },
    date_of_birth: { ES: '¿Cuál es su fecha de nacimiento?', ZH: '您的出生日期是什么？', HT: 'Ki dat nesans ou?', AR: 'ما هو تاريخ ميلادك؟' },
    city_of_birth: { ES: '¿En qué ciudad y país nació?', ZH: '您出生在哪个城市和国家？', HT: 'Nan ki vil ak peyi ou fèt?', AR: 'في أي مدينة وبلد وُلدت؟' },
    citizenship: { ES: '¿Cuál es su nacionalidad (ciudadanía) actual?', ZH: '您目前的国籍（公民身份）是什么？', HT: 'Ki nasyonalite (sitwayènte) ou kounye a?', AR: 'ما هي جنسيتك (مواطنتك) الحالية؟' },
  },
  'I-765': {
    application_reason: { ES: '¿Es esta una solicitud inicial, un reemplazo o una renovación?', ZH: '这是初次申请、补发还是续期？', HT: 'Èske se yon premye aplikasyon, yon ranplasman, oswa yon renouvèlman?', AR: 'هل هذا طلب أولي أم استبدال أم تجديد؟' },
    family_name: { ES: '¿Cuál es su apellido?', ZH: '您的姓氏是什么？', HT: 'Ki non fanmi ou?', AR: 'ما هو اسم عائلتك؟' },
    given_name: { ES: '¿Cuál es su nombre?', ZH: '您的名字是什么？', HT: 'Ki prenon ou?', AR: 'ما هو اسمك الأول؟' },
    mailing_street: { ES: '¿Cuál es su dirección postal en EE. UU.?', ZH: '您的美国邮寄地址是什么？', HT: 'Ki adrès postal ou Ozetazini?', AR: 'ما هو عنوانك البريدي في الولايات المتحدة؟' },
    mailing_city: { ES: '¿Ciudad de la dirección postal?', ZH: '邮寄地址城市？', HT: 'Vil adrès postal?', AR: 'مدينة العنوان البريدي؟' },
    mailing_region: { ES: '¿Estado de la dirección postal?', ZH: '邮寄地址州？', HT: 'Eta adrès postal?', AR: 'ولاية العنوان البريدي؟' },
    mailing_postal_code: { ES: '¿Código postal de la dirección postal?', ZH: '邮寄地址邮政编码？', HT: 'Kòd postal adrès postal?', AR: 'الرمز البريدي للعنوان البريدي؟' },
    gender: { ES: '¿Cuál es su sexo tal como debe aparecer en el formulario (Masculino/Femenino)?', ZH: '您的性别是什么，应如表格所示（男/女）？', HT: 'Ki sèks ou jan li dwe parèt sou fòm nan (Gason/Fi)?', AR: 'ما هو جنسك كما يجب أن يظهر في النموذج (ذكر/أنثى)؟' },
    marital_status: { ES: '¿Cuál es su estado civil?', ZH: '您的婚姻状况是什么？', HT: 'Ki eta sivil ou?', AR: 'ما هي حالتك الاجتماعية؟' },
    citizenship: { ES: '¿Cuál es su país de ciudadanía o nacionalidad?', ZH: '您的公民身份或国籍所属国家是什么？', HT: 'Ki peyi sitwayènte oswa nasyonalite ou?', AR: 'ما هو بلد جنسيتك أو مواطنتك؟' },
    city_of_birth: { ES: '¿En qué ciudad o pueblo nació?', ZH: '您出生在哪个城市或城镇？', HT: 'Nan ki vil ou fèt?', AR: 'في أي مدينة أو بلدة وُلدت؟' },
    country_of_birth: { ES: '¿En qué país nació?', ZH: '您出生在哪个国家？', HT: 'Nan ki peyi ou fèt?', AR: 'في أي بلد وُلدت؟' },
    date_of_birth: { ES: '¿Cuál es su fecha de nacimiento?', ZH: '您的出生日期是什么？', HT: 'Ki dat nesans ou?', AR: 'ما هو تاريخ ميلادك؟' },
  },
};

/**
 * The missing-information question for a field in `lang`: the
 * localized explanation when one exists, else the field's own
 * (English) question, else null (caller falls back to its template).
 */
export function localizedFieldQuestion(entry, field, lang) {
  if (!field) return null;
  if (lang && lang !== 'EN') {
    const q = FIELD_QUESTION_I18N[entry?.id]?.[field.factId]?.[lang];
    if (q) return q;
  }
  return field.question ? field.question : null;
}

/** The registry entry's applicability prose in `lang` (EN default). */
export function localizedApplicability(entry, lang) {
  if (!entry) return '';
  if (lang && lang !== 'EN' && entry.applicabilityI18n && entry.applicabilityI18n[lang]) {
    return entry.applicabilityI18n[lang];
  }
  return entry.applicability || '';
}

/**
 * Fields that must NEVER be populated by IRU, enforced in code on top of
 * the registry (defense in depth): anything signature-related.
 */
export const SIGNATURE_FIELD_PATTERN = /signature/i;

export function assertNoSignatureFields(entry) {
  for (const f of entry.fields) {
    if (SIGNATURE_FIELD_PATTERN.test(f.pdfField) || SIGNATURE_FIELD_PATTERN.test(f.label || '')) {
      throw new Error(`registry: signature field must never be mapped (${f.pdfField})`);
    }
  }
}
for (const entry of FORM_REGISTRY) assertNoSignatureFields(entry);
