import type { IrLayer } from "./ir.ts";

export const MD_EXT = new Set([".md", ".markdown", ".mdx"]);

type MdLink = { readonly text: string; readonly url: string; readonly line: number };
type MdCodeBlock = { readonly lang: string; readonly lines: number; readonly startLine: number };
type MdImage = { readonly alt: string; readonly url: string; readonly line: number };
type MdSection = {
  readonly level: number;
  readonly title: string;
  readonly line: number;
  readonly bodyLines: ReadonlyArray<string>;
};

type ParsedMd = {
  readonly preamble: ReadonlyArray<string>;
  readonly sections: ReadonlyArray<MdSection>;
  readonly links: ReadonlyArray<MdLink>;
  readonly codeBlocks: ReadonlyArray<MdCodeBlock>;
  readonly images: ReadonlyArray<MdImage>;
  readonly frontmatterKeys: ReadonlyArray<string>;
};

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

const truncate = (text: string, max = 140): string => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
};

const stripMdInline = (text: string): string =>
  text
    .replace(IMAGE_RE, (_, alt: string) => (alt ? `img:${alt}` : "img"))
    .replace(LINK_RE, (_, label: string) => label || "link")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");

const stripImages = (text: string): string => text.replace(IMAGE_RE, "");

const collectLinks = (text: string, line: number, links: Array<MdLink>): void => {
  for (const match of stripImages(text).matchAll(LINK_RE)) {
    links.push({ text: match[1] ?? "", url: match[2] ?? "", line });
  }
};

const collectImages = (text: string, line: number, images: Array<MdImage>): void => {
  for (const match of text.matchAll(IMAGE_RE)) {
    images.push({ alt: match[1] ?? "", url: match[2] ?? "", line });
  }
};

const parseFrontmatter = (
  lines: ReadonlyArray<string>,
): { bodyStart: number; keys: ReadonlyArray<string> } => {
  if (lines[0]?.trim() !== "---") {
    return { bodyStart: 0, keys: [] };
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      const keys: Array<string> = [];
      for (let j = 1; j < i; j++) {
        const key = (lines[j] ?? "").split(":")[0]?.trim();
        if (key) {
          keys.push(key);
        }
      }
      return { bodyStart: i + 1, keys };
    }
  }
  return { bodyStart: 0, keys: [] };
};

const parseMarkdown = (source: string): ParsedMd => {
  const lines = source.split("\n");
  const { bodyStart, keys: frontmatterKeys } = parseFrontmatter(lines);
  const links: Array<MdLink> = [];
  const images: Array<MdImage> = [];
  const codeBlocks: Array<MdCodeBlock> = [];
  const sections: Array<MdSection> = [];
  const preamble: Array<string> = [];

  let i = bodyStart;
  let current: MdSection | null = null;
  let inCode = false;
  let codeLang = "";
  let codeStart = 0;
  let codeLines = 0;

  const pushBody = (line: string, lineNo: number): void => {
    if (current) {
      current.bodyLines.push(line);
    } else {
      preamble.push(line);
    }
    collectLinks(line, lineNo, links);
    collectImages(line, lineNo, images);
  };

  while (i < lines.length) {
    const lineNo = i + 1;
    const line = lines[i] ?? "";

    if (!inCode) {
      const fence = line.match(/^```(.*)$/);
      if (fence) {
        inCode = true;
        codeLang = (fence[1] ?? "").trim() || "text";
        codeStart = lineNo;
        codeLines = 0;
        i++;
        continue;
      }

      const heading = line.match(HEADING_RE);
      if (heading) {
        if (current) {
          sections.push(current);
        }
        current = {
          level: heading[1]?.length ?? 1,
          title: stripMdInline(heading[2] ?? ""),
          line: lineNo,
          bodyLines: [],
        };
        collectLinks(line, lineNo, links);
        i++;
        continue;
      }
    } else if (line.startsWith("```")) {
      codeBlocks.push({ lang: codeLang, lines: codeLines, startLine: codeStart });
      inCode = false;
      codeLang = "";
      codeLines = 0;
      i++;
      continue;
    } else {
      codeLines++;
      i++;
      continue;
    }

    pushBody(line, lineNo);
    i++;
  }

  if (current) {
    sections.push(current);
  }

  return { preamble, sections, links, codeBlocks, images, frontmatterKeys };
};

const indentFor = (level: number): string => "  ".repeat(Math.max(0, level - 1));

const summarizeBody = (bodyLines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const out: Array<string> = [];
  for (const raw of bodyLines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      continue;
    }
    if (/^[-*+]\s/.test(line)) {
      out.push(`- ${truncate(stripMdInline(line.replace(/^[-*+]\s+/, "")))}`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      out.push(truncate(stripMdInline(line)));
      continue;
    }
    if (line.startsWith("|")) {
      out.push(truncate(stripMdInline(line)));
      continue;
    }
    out.push(truncate(stripMdInline(line)));
    if (out.length >= 4) {
      break;
    }
  }
  return out;
};

const formatLinks = (links: ReadonlyArray<MdLink>, limit = 12): ReadonlyArray<string> => {
  const unique = new Map<string, MdLink>();
  for (const link of links) {
    unique.set(`${link.text}|${link.url}`, link);
  }
  return [...unique.values()].slice(0, limit).map((link) => {
    const label = link.text || link.url;
    return `LINK [L${link.line}]: ${truncate(label, 80)} → ${truncate(link.url, 100)}`;
  });
};

const formatCodeBlocks = (blocks: ReadonlyArray<MdCodeBlock>): ReadonlyArray<string> =>
  blocks.map((block) => `CODE [L${block.startLine}]: ${block.lang} (${block.lines} lines)`);

const formatImages = (images: ReadonlyArray<MdImage>, limit = 6): ReadonlyArray<string> =>
  images.slice(0, limit).map((img) => {
    const label = img.alt || img.url;
    return `IMG [L${img.line}]: ${truncate(label, 80)}`;
  });

export const generateMdIr = (source: string, layer: IrLayer, filePath?: string): string => {
  if (layer === "L3") {
    return source;
  }

  const parsed = parseMarkdown(source);
  const label = filePath ? filePath.split("/").pop() ?? filePath : "markdown";

  if (layer === "L0") {
    const lines: Array<string> = [label];
    if (parsed.frontmatterKeys.length > 0) {
      lines.push(`META: ${parsed.frontmatterKeys.join(", ")}`);
    }
    for (const section of parsed.sections) {
      lines.push(`${indentFor(section.level)}H${section.level} ${section.title} L${section.line}`);
    }
    if (parsed.links.length > 0) {
      lines.push(`LINKS: ${parsed.links.length}`);
    }
    if (parsed.codeBlocks.length > 0) {
      const codeLines = parsed.codeBlocks.reduce((sum, block) => sum + block.lines, 0);
      lines.push(`CODE: ${parsed.codeBlocks.length} blocks (${codeLines} lines)`);
    }
    if (parsed.images.length > 0) {
      lines.push(`IMAGES: ${parsed.images.length}`);
    }
    return lines.join("\n");
  }

  // L1 and L2 (L2 not meaningful for markdown — same compressed view)
  const lines: Array<string> = [`# ${label}`];
  if (parsed.frontmatterKeys.length > 0) {
    lines.push(`META: ${parsed.frontmatterKeys.join(", ")}`);
  }

  if (parsed.preamble.length > 0) {
    const intro = summarizeBody(parsed.preamble);
    if (intro.length > 0) {
      lines.push("", "PREAMBLE:", ...intro);
    }
  }

  for (const section of parsed.sections) {
    lines.push("", `${"#".repeat(section.level)} ${section.title} [L${section.line}]`);
    const body = summarizeBody(section.bodyLines);
    if (body.length > 0) {
      lines.push(...body);
    }
  }

  const linkLines = formatLinks(parsed.links);
  if (linkLines.length > 0) {
    lines.push("", "LINKS:", ...linkLines);
  }

  const codeLines = formatCodeBlocks(parsed.codeBlocks);
  if (codeLines.length > 0) {
    lines.push("", "CODE:", ...codeLines);
  }

  const imageLines = formatImages(parsed.images);
  if (imageLines.length > 0) {
    lines.push("", "IMAGES:", ...imageLines);
  }

  return lines.join("\n").trimEnd();
};
