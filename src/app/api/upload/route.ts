import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import mammoth from "mammoth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileName = file.name;
    const ext = path.extname(fileName).toLowerCase();

    if (![".pdf", ".docx", ".doc", ".txt"].includes(ext)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload .pdf, .docx, .doc, or .txt" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let text = "";

    if (ext === ".docx" || ext === ".doc") {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (ext === ".pdf") {
      // Dynamic import for pdf-parse
      const pdfModule = await import("pdf-parse");
      const pdfParse = (pdfModule as any).default || pdfModule;
      const pdfData = await pdfParse(buffer);
      text = pdfData.text;
    } else if (ext === ".txt") {
      text = buffer.toString("utf-8");
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from the file. The file may be empty or corrupted." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      fileName,
      charCount: text.length,
      text,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process file" },
      { status: 500 }
    );
  }
}
