import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { config } from "./config.js";
const metadata = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  triggers: z.array(z.string()),
  tools: z.array(z.string()),
  enabled: z.boolean().default(true),
});
export class Skills {
  async list() {
    await fs.mkdir(config.skills, { recursive: true });
    const result = [];
    for (const name of await fs.readdir(config.skills)) {
      try {
        const file = path.join(config.skills, name, "SKILL.md");
        const raw = await fs.readFile(file, "utf8");
        const parsed = matter(raw);
        result.push({
          ...metadata.parse(parsed.data),
          content: parsed.content,
          raw,
        });
      } catch {
        continue;
      }
    }
    return result;
  }
  async save(raw: string) {
    const parsed = matter(raw),
      meta = metadata.parse(parsed.data);
    const dir = path.join(config.skills, meta.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), raw);
    return meta;
  }
  async remove(name: string) {
    metadata.shape.name.parse(name);
    await fs.rm(path.join(config.skills, name), {
      recursive: true,
      force: true,
    });
  }
  async relevant(text: string) {
    const browserToolsAvailable = text.includes("chrome-devtools__");
    const skills = await this.list();
    const relevant = skills
      .filter(
        (s) =>
          s.enabled &&
          (s.triggers.some((t) =>
            text.toLowerCase().includes(t.toLowerCase()),
          ) ||
            s.description
              .toLowerCase()
              .split(/\W+/)
              .filter((t) => t.length > 5)
              .some((t) => text.toLowerCase().includes(t))),
      )
      .slice(0, 3);
    if (browserToolsAvailable) {
      for (const name of ["chrome-devtools", "troubleshooting"]) {
        const skill = skills.find((item) => item.name === name && item.enabled);
        if (skill && !relevant.some((item) => item.name === name)) relevant.push(skill);
      }
    }
    return relevant
      .map(
        (s) =>
          `Skill ${s.name}: ${s.description}. Use read_skill for the full instructions.`,
      )
      .join("\n");
  }
}
