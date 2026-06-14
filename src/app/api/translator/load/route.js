import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const logsDir = path.join(process.cwd(), "logs", "translator");

const ALLOWED_FILES = [
  "1_req_client.json",
  "2_req_source.json",
  "3_req_openai.json",
  "4_req_target.json",
  "5_res_provider.txt",
  "6_res_openai.txt",
  "7_res_client.txt",
  "7_res_client.json",
];

/** Read a translator log file (returns content or null if not found) */
async function readLogFile(file) {
  try {
    return await fs.readFile(path.join(logsDir, file), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");

    if (!file) {
      return NextResponse.json({ success: false, error: "File parameter required" }, { status: 400 });
    }

    if (!ALLOWED_FILES.includes(file)) {
      return NextResponse.json({ success: false, error: "Invalid file name" }, { status: 400 });
    }

    const content = await readLogFile(file);
    if (content === null) {
      return NextResponse.json({ success: false, error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error("Error loading file:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
