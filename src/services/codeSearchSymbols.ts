import type { Node } from "web-tree-sitter";
import type { IndexedSymbol } from "./codeSearch.ts";
import type { SymbolKind } from "./codeSearchLang.ts";

const SYMBOL_TYPES: Record<string, SymbolKind> = {
  function_declaration: "function",
  class_declaration: "class",
  class_definition: "class",
  method_declaration: "method",
  type_spec: "type",
  trait_item: "interface",
  enum_item: "enum",
  const_item: "const",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  method_definition: "method",
  lexical_declaration: "const",
  function_definition: "function",
  function_item: "function",
  struct_item: "class",
  impl_item: "class",
};

function nodeName(node: Node): string | null {
  const direct = node.childForFieldName("name");
  if (direct !== null) return direct.text;
  const first = node.namedChildren.find((child): child is Node => child !== null);
  if (first === undefined) return null;
  const nested = first.childForFieldName("name");
  return nested !== null ? nested.text : null;
}

export function extractSymbols(root: Node): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  const visit = (node: Node): void => {
    const kind = SYMBOL_TYPES[node.type];
    if (kind !== undefined) {
      const name = nodeName(node);
      if (name !== null && name.length > 0) {
        symbols.push({
          kind,
          name,
          line: node.startPosition.row + 1,
          exported:
            node.parent?.type === "export_statement" ||
            node.namedChildren.some(
              (child) => child?.type === "visibility_modifier" && child.text.startsWith("pub"),
            ) ||
            (node.type === "function_definition" || node.type === "class_definition"
              ? !name.startsWith("_")
              : ["type_spec", "method_declaration"].includes(node.type) ||
                  (node.type === "function_declaration" && root.type === "source_file")
                ? /^[A-Z]/.test(name)
                : false),
        });
      }
    }
    for (const child of node.children) {
      if (child?.isNamed) visit(child);
    }
  };
  visit(root);
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return symbols;
}
