import "reflect-metadata"
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import compression from "compression";
import jwt from "jsonwebtoken";
import { db } from "./database.js";
import { User } from "./model/user.js";
import * as auth from "./auth.js";
import * as data from "./data.js";
import * as sync from "./sync.js";

dotenv.config();
const app = express();

const endMiddleware = (req: Request, res: Response, next: any) => {
    if (process.env.MODE !== "prod") {
        console.log("BODY", req.body);
    }
    next();
};

app.use(express.static("public"));
app.use(cors({
    origin: process.env.MODE !== "prod" ? "http://localhost:25565" : process.env.CORS_ORIGIN_URL
}));
app.use(express.json({ limit: "50mb" }));
app.use(endMiddleware);
app.use(compression());

(async () => {
    await db.sequelize.sync({
        force: process.env.MODE !== 'prod'
    });
})();

auth.registerEndpoints(app);
data.registerEndpoints(app);
sync.registerEndpoints(app);

app.get("/", (req: Request, res: Response) => {
    res.status(200).send("OK");
});

// --- Mangayomi v0.9+ Sync Protocol Endpoints ---

const extractUser = async (req: Request): Promise<User | null> => {
  let token: string | null = null;
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/id=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) return null;
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET_KEY ?? "mangayomi");
    return await User.findOne({ where: { email: decoded.email } });
  } catch {
    return null;
  }
};

function mergeItems(
  existing: any[] = [],
  incoming: any[] = [],
  deletedIds: (number | string)[] = [],
  resetAll: boolean = false
): any[] {
  if (resetAll) return incoming || [];
  const deletedSet = new Set((deletedIds || []).map((x) => String(x)));
  const map = new Map<string, any>();
  for (const item of existing || []) {
    const key = String(item?.id ?? item?.clientId ?? "");
    if (key && !deletedSet.has(key)) {
      map.set(key, item);
    }
  }
  for (const item of incoming || []) {
    const key = String(item?.id ?? item?.clientId ?? "");
    if (key && !deletedSet.has(key)) {
      const cur = map.get(key);
      if (!cur || (item.updatedAt || 0) >= (cur.updatedAt || 0)) {
        map.set(key, item);
      }
    }
  }
  return Array.from(map.values());
}

app.post("/sync/manga", async (req: Request, res: Response) => {
  const user = await extractUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const currentData = user.backupData ? JSON.parse(user.backupData) : {};
    const resetAll = !!req.body.resetAll;
    currentData.categories = mergeItems(
      currentData.categories,
      req.body.categories,
      req.body.deleted_categories,
      resetAll
    );
    currentData.manga = mergeItems(
      currentData.manga,
      req.body.manga,
      req.body.deleted_manga,
      resetAll
    );
    currentData.chapters = mergeItems(
      currentData.chapters,
      req.body.chapters,
      req.body.deleted_chapters,
      resetAll
    );
    currentData.tracks = mergeItems(
      currentData.tracks,
      req.body.tracks,
      req.body.deleted_tracks,
      resetAll
    );
    user.backupData = JSON.stringify(currentData);
    await user.save();
    res.status(200).json({
      categories: currentData.categories || [],
      manga: currentData.manga || [],
      chapters: currentData.chapters || [],
      tracks: currentData.tracks || [],
      deleted_categories: [],
      deleted_manga: [],
      deleted_chapters: [],
      deleted_tracks: [],
      resetAll: false,
    });
  } catch (e: any) {
    console.error("Manga sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/sync/histories", async (req: Request, res: Response) => {
  const user = await extractUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const currentData = user.backupData ? JSON.parse(user.backupData) : {};
    const resetAll = !!req.body.resetAll;
    currentData.histories = mergeItems(
      currentData.histories,
      req.body.histories,
      req.body.deleted_histories,
      resetAll
    );
    user.backupData = JSON.stringify(currentData);
    await user.save();
    res.status(200).json({
      histories: currentData.histories || [],
      deleted_histories: [],
      resetAll: false,
    });
  } catch (e: any) {
    console.error("History sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/sync/updates", async (req: Request, res: Response) => {
  const user = await extractUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const currentData = user.backupData ? JSON.parse(user.backupData) : {};
    const resetAll = !!req.body.resetAll;
    currentData.updates = mergeItems(
      currentData.updates,
      req.body.updates,
      req.body.deleted_updates,
      resetAll
    );
    user.backupData = JSON.stringify(currentData);
    await user.save();
    res.status(200).json({
      updates: currentData.updates || [],
      deleted_updates: [],
      resetAll: false,
    });
  } catch (e: any) {
    console.error("Updates sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/sync/settings", async (req: Request, res: Response) => {
  const user = await extractUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const currentData = user.backupData ? JSON.parse(user.backupData) : {};
    if (req.body.settings) {
      currentData.settings = req.body.settings;
      user.backupData = JSON.stringify(currentData);
      await user.save();
    }
    res.status(200).json({
      settings: currentData.settings || {},
    });
  } catch (e: any) {
    console.error("Settings sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT, () => {
    console.log(`Server is running at http://0.0.0.0:${process.env.PORT}`);
});
