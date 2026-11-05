// Wrapper that resolves Tier 1 form configs statically
import Tier1Flow, { Tier1Lang } from './Tier1Flow';
import { N400_QUESTIONS, N400_STEPS, N400_FORM_INFO } from './n400-questions';
import { I130_QUESTIONS, I130_STEPS, I130_FORM_INFO } from './i130-questions';
import { I485_QUESTIONS, I485_STEPS, I485_FORM_INFO } from './i485-questions';
import { I90_QUESTIONS, I90_STEPS, I90_FORM_INFO } from './i90-questions';
import { I589_QUESTIONS, I589_STEPS, I589_FORM_INFO } from './i589-questions';
import { I765_QUESTIONS, I765_STEPS, I765_FORM_INFO } from './i765-questions';
import { assessN400, assessI130, assessI485, assessI90, assessI589, assessI765 } from './tier1-assess';

const CONFIGS: Record<string, { q: any; s: any; i: any; assess: any }> = {
  n400: { q: N400_QUESTIONS, s: N400_STEPS, i: N400_FORM_INFO, assess: assessN400 },
  i130: { q: I130_QUESTIONS, s: I130_STEPS, i: I130_FORM_INFO, assess: assessI130 },
  i485: { q: I485_QUESTIONS, s: I485_STEPS, i: I485_FORM_INFO, assess: assessI485 },
  i90: { q: I90_QUESTIONS, s: I90_STEPS, i: I90_FORM_INFO, assess: assessI90 },
  i589: { q: I589_QUESTIONS, s: I589_STEPS, i: I589_FORM_INFO, assess: assessI589 },
  i765: { q: I765_QUESTIONS, s: I765_STEPS, i: I765_FORM_INFO, assess: assessI765 },
};

export default function Tier1FlowWrapper({ formKey, lang, onExit, onFormprepCheckout }: { formKey: string; lang: Tier1Lang; onExit: () => void; onFormprepCheckout?: (forms: string[]) => void }) {
  const cfg = CONFIGS[formKey];
  if (!cfg) return <div>Unknown form: {formKey}</div>;
  return <Tier1Flow formKey={formKey} questions={cfg.q} steps={cfg.s} info={cfg.i} lang={lang} assess={cfg.assess} onExit={onExit} onFormprepCheckout={onFormprepCheckout} />;
}
