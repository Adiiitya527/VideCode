import { type NextRequest, NextResponse } from "next/server";

interface CodeSuggestionRequest {
  fileContent: string;
  cursorLine: number;
  cursorColumn: number;
  suggestionType: string;
  fileName?: string;
}

interface CodeContext {
  language: string;
  framework: string;
  beforeContext: string;
  partialLine: string;
  afterContext: string;
  cursorPosition: { line: number; column: number };
  isInFunction: boolean;
  isInClass: boolean;
  isAfterComment: boolean;
  incompletePatterns: string[];
}

// ✅ Abort any request that takes longer than 8 seconds
// codellama on CPU takes 2+ minutes — useless for inline suggestions
const OLLAMA_TIMEOUT_MS = 8000;

export async function POST(request: NextRequest) {
  try {
    const body: CodeSuggestionRequest = await request.json();

    const { fileContent, cursorLine, cursorColumn, suggestionType, fileName } = body;

    if (!fileContent || cursorLine < 0 || cursorColumn < 0 || !suggestionType) {
      return NextResponse.json(
        { error: "Invalid input parameters" },
        { status: 400 }
      );
    }

    const context = analyzeCodeContext(fileContent, cursorLine, cursorColumn, fileName);

    if (!context.partialLine.trim()) {
      return NextResponse.json({ suggestion: null });
    }

    const prompt = buildPrompt(context);
    const suggestion = await generateSuggestion(prompt, context.partialLine);

    return NextResponse.json({
      suggestion,
      metadata: {
        language: context.language,
        framework: context.framework,
        position: context.cursorPosition,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Context analysis error:", error);
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    );
  }
}

function analyzeCodeContext(
  content: string,
  line: number,
  column: number,
  fileName?: string
): CodeContext {
  const lines = content.split("\n");
  const contextRadius = 5;
  const startLine = Math.max(0, line - contextRadius);
  const endLine = Math.min(lines.length, line + contextRadius);

  // beforeContext must NOT include the current line — prevents model echoing it
  const beforeContext = lines.slice(startLine, line).join("\n");
  const partialLine = (lines[line] || "").substring(0, column);
  const afterContext = lines.slice(line + 1, endLine).join("\n");

  const language = detectLanguage(content, fileName);
  const framework = detectFramework(content);
  const isInFunction = detectInFunction(lines, line);
  const isInClass = detectInClass(lines, line);
  const isAfterComment = detectAfterComment(lines[line] || "", column);
  const incompletePatterns = detectIncompletePatterns(lines[line] || "", column);

  return {
    language,
    framework,
    beforeContext,
    partialLine,
    afterContext,
    cursorPosition: { line, column },
    isInFunction,
    isInClass,
    isAfterComment,
    incompletePatterns,
  };
}

function buildPrompt(context: CodeContext): string {
  // codellama:latest uses Llama 2 instruct format: [INST] ... [/INST]
  // FIM tokens (<PRE>/<SUF>/<MID>) only work on codellama:code variant
  // Keep the prompt extremely short — less tokens = faster response on CPU
  return `[INST] Complete this ${context.language} line. Reply with ONLY the completion, nothing else:
${context.beforeContext}
${context.partialLine} [/INST]`;
}

async function generateSuggestion(
  prompt: string,
  partialLine: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(); // ✅ kill the request if it takes too long
  }, OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal, // ✅ attach abort signal
      body: JSON.stringify({
        model: "codellama:latest",
        prompt,
        stream: false,
        options: {
          num_predict: 30,      // ✅ very short — we only want end of current line
          temperature: 0.1,
          stop: ["\n", "[INST]", "[/INST]", "```", "//", "/*"],
        },
      }),
    });

    clearTimeout(timeout);

    const text = await response.text();
    console.log("RAW OLLAMA:", text);

    const data = JSON.parse(text);

    // Graceful Ollama-level errors (OOM, model not found, etc.)
    if (data.error) {
      console.error("Ollama error:", data.error);
      return null;
    }

    if (!response.ok) {
      throw new Error(`AI service error: ${response.statusText}`);
    }

    let suggestion: string = data.response;
    if (!suggestion) return null;

    // Strip markdown fences
    suggestion = suggestion
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^```[\w]*\n?/, "")
      .replace(/```$/, "")
      .trimEnd();

    // Strip instruct tags if echoed back
    suggestion = suggestion
      .replace(/\[INST\][\s\S]*?\[\/INST\]/g, "")
      .trim();

    // Deduplicate: strip echoed partial line prefix
    if (suggestion.trimStart().startsWith(partialLine.trimStart())) {
      suggestion = suggestion.trimStart().slice(partialLine.trimStart().length);
    }

    // If suggestion equals the partial line, it's useless
    if (suggestion.trim() === partialLine.trim()) return null;

    // Return only the first non-empty line
    const firstLine = suggestion.split("\n").find((l) => l.trim().length > 0);
    return firstLine?.trimEnd() || null;

  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      console.warn(`Ollama timed out after ${OLLAMA_TIMEOUT_MS}ms — skipping suggestion`);
      return null; // ✅ silently skip, don't crash the editor
    }
    console.error("AI generation error:", error);
    return null;
  }
}

// ── Helper functions ──────────────────────────────────────────────────────────

function detectLanguage(content: string, fileName?: string): string {
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const extMap: Record<string, string> = {
      ts: "TypeScript", tsx: "TypeScript",
      js: "JavaScript", jsx: "JavaScript",
      py: "Python",
      java: "Java",
      go: "Go",
      rs: "Rust",
      php: "PHP",
    };
    if (ext && extMap[ext]) return extMap[ext];
  }

  if (content.includes("interface ") || content.includes(": string")) return "TypeScript";
  if (content.includes("def ") && content.includes(":")) return "Python";
  if (content.includes("func ") || content.includes("package ")) return "Go";

  return "JavaScript";
}

function detectFramework(content: string): string {
  if (content.includes("import React") || content.includes("useState")) return "React";
  if (content.includes("import Vue") || content.includes("<template>")) return "Vue";
  if (content.includes("@angular/") || content.includes("@Component")) return "Angular";
  if (content.includes("next/") || content.includes("getServerSideProps")) return "Next.js";
  return "None";
}

function detectInFunction(lines: string[], currentLine: number): boolean {
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.match(/^\s*(function|def|const\s+\w+\s*=|let\s+\w+\s*=)/)) return true;
    if (line?.match(/^\s*}/)) break;
  }
  return false;
}

function detectInClass(lines: string[], currentLine: number): boolean {
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.match(/^\s*(class|interface)\s+/)) return true;
  }
  return false;
}

function detectAfterComment(line: string, column: number): boolean {
  const beforeCursor = line.substring(0, column);
  return /\/\/.*$/.test(beforeCursor) || /#.*$/.test(beforeCursor);
}

function detectIncompletePatterns(line: string, column: number): string[] {
  const beforeCursor = line.substring(0, column);
  const patterns: string[] = [];

  if (/^\s*(if|while|for)\s*\($/.test(beforeCursor.trim())) patterns.push("conditional");
  if (/^\s*(function|def)\s*$/.test(beforeCursor.trim())) patterns.push("function");
  if (/\{\s*$/.test(beforeCursor)) patterns.push("object");
  if (/\[\s*$/.test(beforeCursor)) patterns.push("array");
  if (/=\s*$/.test(beforeCursor)) patterns.push("assignment");
  if (/\.\s*$/.test(beforeCursor)) patterns.push("method-call");

  return patterns;
}