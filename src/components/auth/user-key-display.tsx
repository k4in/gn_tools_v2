import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyToClipboard } from "@/lib/features/copy-to-clipboard.ts";
import { formatUserKey } from "@/lib/utils/user-key.ts";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/shadcn/input-group.tsx";

type UserKeyDisplayProps = {
  userKey: string;
};

export function UserKeyDisplay({ userKey }: UserKeyDisplayProps) {
  const [copied, setCopied] = useState(false);
  const formattedKey = formatUserKey(userKey);

  async function copy() {
    if (!(await copyToClipboard(formattedKey))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <InputGroup>
      <InputGroupInput value={formattedKey} readOnly aria-label="Dein Code" className="font-mono tracking-widest" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={() => void copy()} aria-label="Code kopieren">
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
