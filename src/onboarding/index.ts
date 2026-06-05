// Onboarding persistence + public surface. localStorage-backed flags for the
// one-time welcome walkthrough and the getting-started checklist, all wrapped in
// try/catch so an SSR/private-mode/quota failure never throws into render. Web
// build only — App gates every consumer on `!isTauri()`.

const WELCOME_KEY = "flaglabel_ob_welcome_v1";
const CHECKLIST_KEY = "flaglabel_ob_checklist_v1";

// Default to seen=true on failure so a broken storage layer never nags the user
// with the modal on every load.
export function obWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return true;
  }
}

export function markObWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function resetObWelcome(): void {
  try {
    localStorage.removeItem(WELCOME_KEY);
  } catch {
    /* ignore */
  }
}

// Default to dismissed=false on failure so the checklist still shows (and tracks
// real progress) even when persistence is unavailable.
export function obChecklistDismissed(): boolean {
  try {
    return localStorage.getItem(CHECKLIST_KEY) === "1";
  } catch {
    return false;
  }
}

export function markObChecklistDismissed(): void {
  try {
    localStorage.setItem(CHECKLIST_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function resetObChecklist(): void {
  try {
    localStorage.removeItem(CHECKLIST_KEY);
  } catch {
    /* ignore */
  }
}

export { WelcomeModal } from "./WelcomeModal";
export { GettingStartedChecklist } from "./GettingStartedChecklist";
export { ProductTour } from "./ProductTour";
