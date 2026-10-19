import type { TestProviderResponse } from "@/api/types";
import type { ProviderForm, ProviderMeta } from "../providerModels";

/** Props of one provider card in Settings → Models & providers. */
export interface ProviderAccordionProps {
  meta: ProviderMeta;
  provider?: ProviderForm;
  open: boolean;
  count: number;
  test?: TestProviderResponse;
  testing: boolean;
  authBusy?: boolean;
  connectionLabel?: string;
  chatOptions?: string[];
  embedOptions?: string[];
  onToggle: () => void;
  onAdd: () => void;
  onPatch: (patch: Partial<ProviderForm>) => void;
  onRemove: () => void;
  onTest: () => void;
  onConnect?: () => void;
}
