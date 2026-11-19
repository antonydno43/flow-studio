/**
 * Centralized node registry. New nodes register here and become available to
 * the editor, validator, and execution engine without engine changes.
 */
import type { NodeDefinition } from "@/core/types";
import { manualTrigger, scheduleTrigger, webhookTrigger } from "./definitions/triggers";
import { httpRequestNode, webhookResponseNode } from "./definitions/http";
import {
  ifNode, switchNode, filterNode, loopItemsNode, splitBatchesNode,
  loopEndNode, mergeNode, waitNode, stopNode,
} from "./definitions/control";
import {
  setFieldsNode, editFieldsNode, renameFieldsNode, removeFieldsNode,
  jsonParseNode, jsonCreateNode, csvParseNode, csvGenerateNode,
  textFormatterNode, replaceTextNode, splitTextNode, joinTextNode,
  arrayAggregatorNode, objectAggregatorNode, dateFormatterNode, dateDiffNode,
  mathNode, typeConversionNode, sortArrayNode, removeDuplicatesNode,
} from "./definitions/transforms";
import {
  sendEmailNode, slackMessageNode, discordMessageNode, supabaseNode,
} from "./definitions/integrations";

const definitions: NodeDefinition[] = [
  // Triggers
  manualTrigger,
  scheduleTrigger,
  webhookTrigger,
  // HTTP & APIs
  httpRequestNode,
  webhookResponseNode,
  // Conditions & Logic
  ifNode,
  switchNode,
  filterNode,
  mergeNode,
  waitNode,
  stopNode,
  // Loops
  loopItemsNode,
  splitBatchesNode,
  loopEndNode,
  // Data transformation
  setFieldsNode,
  editFieldsNode,
  renameFieldsNode,
  removeFieldsNode,
  jsonParseNode,
  jsonCreateNode,
  csvParseNode,
  csvGenerateNode,
  textFormatterNode,
  replaceTextNode,
  splitTextNode,
  joinTextNode,
  arrayAggregatorNode,
  objectAggregatorNode,
  dateFormatterNode,
  dateDiffNode,
  mathNode,
  typeConversionNode,
  sortArrayNode,
  removeDuplicatesNode,
  // Integrations
  sendEmailNode,
  slackMessageNode,
  discordMessageNode,
  supabaseNode,
];

const registry = new Map<string, NodeDefinition>();
for (const def of definitions) {
  if (registry.has(def.type)) {
    throw new Error(`Duplicate node type registered: ${def.type}`);
  }
  registry.set(def.type, def);
}

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return registry.get(type);
}

export function getNodeDefinitions(): NodeDefinition[] {
  return [...registry.values()];
}

/** Client-safe metadata (no execute functions serialized). */
export interface NodeCatalogEntry {
  type: string;
  version: number;
  name: string;
  description: string;
  category: string;
  icon: string;
  kind: "trigger" | "action" | "logic";
  inputs: number;
  outputs: { id: string; label: string; color?: string }[];
  configSchema: NodeDefinition["configSchema"];
  defaultConfig: Record<string, unknown>;
  outputHint?: string;
}

export function getCatalog(): NodeCatalogEntry[] {
  return getNodeDefinitions().map((d) => ({
    type: d.type,
    version: d.version,
    name: d.name,
    description: d.description,
    category: d.category,
    icon: d.icon,
    kind: d.kind,
    inputs: d.inputs,
    outputs: d.outputs,
    configSchema: d.configSchema,
    defaultConfig: d.defaultConfig,
    outputHint: d.outputHint,
  }));
}

export const NODE_CATEGORIES = [
  "Triggers",
  "HTTP & APIs",
  "Conditions & Logic",
  "Loops",
  "Data Transformation",
  "Communication",
  "Integrations",
];
