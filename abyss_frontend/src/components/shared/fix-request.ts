"use client";

import { createContext, useContext } from "react";

/**
 * Whether a live preview or visual may offer "Ask the agent to fix it".
 * The chat turns it off for every answer except the latest one: once the
 * agent has replied (e.g. with a fixed version), the older answer still
 * shows what went wrong, but asking to fix it again would be stale.
 * Default true, so anywhere outside a chat keeps the button.
 */
export const FixRequestContext = createContext(true);

export const useCanAskToFix = () => useContext(FixRequestContext);
