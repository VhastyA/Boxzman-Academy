const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const VIDEO_DIR = path.join(DATA_DIR, "videos");
const DB_PATH = path.join(DATA_DIR, "forma.sqlite");
const ADMIN_PASSWORD_PATH = path.join(ROOT, ".admin-password");
const envPort = Number(process.env.PORT);
const PORT = envPort && envPort !== 8080 ? envPort : 3000;
const PRICE_MINOR = 18000;
const PAYMENT_CURRENCY = "GHS";
const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || "").trim();
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const SESSION_DAYS = 30;
const SESSION_COOKIE = "forma_session";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

fs.mkdirSync(VIDEO_DIR, { recursive: true });
const database = new DatabaseSync(DB_PATH);
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    duration TEXT NOT NULL,
    image TEXT NOT NULL,
    price_minor INTEGER NOT NULL DEFAULT 18000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration TEXT NOT NULL,
    quiz TEXT NOT NULL,
    choices_json TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    video_file TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('student', 'admin')),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_tickets (
    token_hash TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    method TEXT NOT NULL,
    status TEXT NOT NULL,
    paystack_reference TEXT,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS paystack_transactions (
    reference TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    method TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GHS',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    verified_at INTEGER,
    claimed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS enrollments (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    payment_method TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    payment_status TEXT NOT NULL,
    paystack_reference TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, course_id)
  );
  CREATE TABLE IF NOT EXISTS progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, lesson_id)
  );
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some(col => col.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn("payment_tickets", "paystack_reference", "TEXT");
ensureColumn("payment_tickets", "amount_minor", "INTEGER");
ensureColumn("enrollments", "paystack_reference", "TEXT");
ensureColumn("users", "has_password", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("courses", "price_minor", "INTEGER NOT NULL DEFAULT 18000");

function migrateCoursesTableIfNeeded() {
  const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'courses'").get();
  if (!schema?.sql || !/\bCHECK\b/i.test(schema.sql)) return;
  database.exec("PRAGMA foreign_keys = OFF;");
  try {
    database.exec("BEGIN");
    database.exec(`
      CREATE TABLE courses_migrated (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        duration TEXT NOT NULL,
        image TEXT NOT NULL,
        price_minor INTEGER NOT NULL DEFAULT 18000,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO courses_migrated (id,title,subtitle,level,category,duration,image,price_minor,created_at)
      SELECT id,title,subtitle,level,category,duration,image,COALESCE(price_minor, 18000),created_at FROM courses;
      DROP TABLE courses;
      ALTER TABLE courses_migrated RENAME TO courses;
    `);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

migrateCoursesTableIfNeeded();
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tickets_reference ON payment_tickets(paystack_reference) WHERE paystack_reference IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_reference ON enrollments(paystack_reference) WHERE paystack_reference IS NOT NULL;
`);

function seedCourses() {
  const count = database.prepare("SELECT COUNT(*) AS count FROM courses").get().count;
  if (count > 0) return;
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-courses.json"), "utf8"));
  const addCourse = database.prepare(
    "INSERT INTO courses (id,title,subtitle,level,category,duration,image) VALUES (?,?,?,?,?,?,?)"
  );
  const addLesson = database.prepare(
    "INSERT INTO lessons (id,course_id,title,duration,quiz,choices_json,answer_index,sort_order) VALUES (?,?,?,?,?,?,?,?)"
  );
  database.exec("BEGIN");
  try {
    for (const course of seed) {
      addCourse.run(course.id, course.title, course.subtitle, course.level, course.category, course.duration, course.image);
      course.lessons.forEach((lesson, index) => {
        addLesson.run(
          crypto.randomUUID(), course.id, lesson.title, lesson.duration, lesson.quiz,
          JSON.stringify(lesson.choices), lesson.answer, index
        );
      });
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

seedCourses();

function ensureAdminPassword() {
  if (process.env.FORMA_ADMIN_PASSWORD) return process.env.FORMA_ADMIN_PASSWORD;
  if (fs.existsSync(ADMIN_PASSWORD_PATH)) return fs.readFileSync(ADMIN_PASSWORD_PATH, "utf8").trim();
  const password = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(ADMIN_PASSWORD_PATH, `${password}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Created local admin password in ${ADMIN_PASSWORD_PATH}`);
  console.log("Set FORMA_ADMIN_PASSWORD to a strong secret before deploying.");
  return password;
}

const adminPassword = ensureAdminPassword();

function jsonResponse(response, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(data);
}

function fail(response, status, message, code) {
  jsonResponse(response, status, { error: message, code });
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const raw = await readRawBody(request);
  try {
    const body = JSON.parse(raw.toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Request body must be a JSON object.");
    }
    return body;
  } catch {
    throw Object.assign(new Error("Request body must be a valid JSON object."), { status: 400 });
  }
}

function paystackChannelsForMethod(methodName) {
  if (methodName === "Visa") return ["card"];
  if (methodName === "MTN MoMo" || methodName === "Telecel Cash") return ["mobile_money"];
  return null;
}

function callbackBaseUrl(request) {
  const configured = (process.env.PAYSTACK_CALLBACK_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const protoHeader = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const hostHeader = String(request.headers["x-forwarded-host"] || request.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  const protocol = protoHeader === "https" || hostHeader.endsWith(".run.app") ? "https" : "http";
  return `${protocol}://${hostHeader}`;
}

async function paystackApi(endpoint, options = {}) {
  if (!PAYSTACK_SECRET_KEY) {
    throw Object.assign(
      new Error("Paystack is not configured on this server. Set PAYSTACK_SECRET_KEY to enable payments."),
      { status: 503, code: "PAYSTACK_NOT_CONFIGURED" }
    );
  }
  const res = await fetch(`https://api.paystack.co${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw Object.assign(new Error("Received an invalid response from Paystack."), { status: 502, code: "PAYSTACK_ERROR" });
  }
  if (!res.ok || !payload?.status) {
    throw Object.assign(
      new Error(payload?.message || "Paystack could not process this payment request."),
      { status: res.status >= 400 && res.status < 500 ? 400 : 502, code: "PAYSTACK_ERROR" }
    );
  }
  return payload.data;
}

function parsePriceMinor(rawValue) {
  const cleaned = String(rawValue ?? "").trim();
  if (!cleaned) return null;
  const amountGhs = Number(cleaned);
  if (!Number.isFinite(amountGhs) || amountGhs < 1 || amountGhs > 100000) return null;
  return Math.round(amountGhs * 100);
}

function formatBuyerName(tx, email) {
  const first = String(tx?.customer?.first_name || "").trim();
  const last = String(tx?.customer?.last_name || "").trim();
  const full = `${first} ${last}`.trim();
  if (full.length >= 2 && full.length <= 100) return full;
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
  if (cleaned.length >= 2 && cleaned.length <= 100) return cleaned;
  return "Academy Student";
}

async function verifyPaystackReference(reference, session) {
  const existingTx = database.prepare("SELECT * FROM paystack_transactions WHERE reference = ?").get(reference);
  const user = session?.role === "student" ? session : null;
  if (existingTx?.status === "claimed") {
    if (user && hasEnrollment(user.id, existingTx.course_id)) {
      return {
        verified: true,
        enrolled: true,
        courseId: existingTx.course_id,
        reference,
        method: existingTx.method,
        amountMinor: existingTx.amount_minor,
        currency: existingTx.currency
      };
    }
    if (!user && existingTx.user_id) {
      const claimedUser = database.prepare("SELECT id,name,email,has_password FROM users WHERE id = ?").get(existingTx.user_id);
      if (claimedUser && claimedUser.has_password === 0 && hasEnrollment(claimedUser.id, existingTx.course_id)) {
        return {
          verified: true,
          enrolled: true,
          autoUserId: claimedUser.id,
          user: { id: claimedUser.id, name: claimedUser.name, email: claimedUser.email },
          autoSignedIn: true,
          courseId: existingTx.course_id,
          reference,
          method: existingTx.method,
          amountMinor: existingTx.amount_minor,
          currency: existingTx.currency
        };
      }
    }
    throw Object.assign(
      new Error("This payment has already been claimed by an account."),
      { status: 409, code: "PAYMENT_ALREADY_CLAIMED", courseId: existingTx.course_id }
    );
  }
  const tx = await paystackApi(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
  if (tx.status !== "success") {
    throw Object.assign(
      new Error(tx.gateway_response || "Payment was not completed."),
      { status: 402, code: "PAYMENT_NOT_COMPLETED", courseId: existingTx?.course_id || tx.metadata?.courseId }
    );
  }
  const courseId = existingTx?.course_id || String(tx.metadata?.courseId || "");
  const course = database.prepare("SELECT id,price_minor FROM courses WHERE id = ?").get(courseId);
  if (!course) {
    throw Object.assign(new Error("The paid course could not be found."), { status: 404, code: "NOT_FOUND" });
  }
  const expectedPriceMinor = Number(existingTx?.amount_minor || course.price_minor || PRICE_MINOR);
  if (String(tx.currency || "").toUpperCase() !== PAYMENT_CURRENCY || Number(tx.amount) < expectedPriceMinor) {
    throw Object.assign(
      new Error("Payment amount or currency did not match the course price."),
      { status: 402, code: "PAYMENT_MISMATCH", courseId }
    );
  }
  const methodName = existingTx?.method || String(tx.metadata?.method || (tx.channel === "mobile_money" ? "MTN MoMo" : "Visa"));
  const customerEmail = String(tx.customer?.email || existingTx?.email || "").trim().toLowerCase();
  const now = Date.now();
  if (user) {
    database.exec("BEGIN");
    try {
      database.prepare(
        "INSERT OR IGNORE INTO enrollments (user_id,course_id,payment_method,amount_minor,payment_status,paystack_reference) VALUES (?,?,?,?,?,?)"
      ).run(user.id, courseId, methodName, Number(tx.amount), "paid", reference);
      database.prepare(`
        INSERT INTO paystack_transactions (reference,course_id,user_id,email,method,amount_minor,currency,status,created_at,verified_at,claimed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(reference) DO UPDATE SET
          status = 'claimed',
          user_id = COALESCE(excluded.user_id, paystack_transactions.user_id),
          verified_at = COALESCE(paystack_transactions.verified_at, excluded.verified_at),
          claimed_at = excluded.claimed_at
      `).run(reference, courseId, user.id, customerEmail, methodName, Number(tx.amount), PAYMENT_CURRENCY, "claimed", now, now, now);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { verified: true, enrolled: true, courseId, reference, method: methodName, amountMinor: Number(tx.amount), currency: PAYMENT_CURRENCY };
  }

  const existingUser = customerEmail
    ? database.prepare("SELECT id,name,email,has_password FROM users WHERE email = ?").get(customerEmail)
    : null;
  if (!existingUser && customerEmail) {
    const newUserId = crypto.randomUUID();
    const buyerName = formatBuyerName(tx, customerEmail);
    const salt = crypto.randomBytes(16).toString("hex");
    const randomHash = crypto.scryptSync(crypto.randomBytes(32).toString("hex"), salt, 64).toString("hex");
    database.exec("BEGIN");
    try {
      database.prepare("INSERT INTO users (id,name,email,salt,password_hash,has_password) VALUES (?,?,?,?,?,0)")
        .run(newUserId, buyerName, customerEmail, salt, randomHash);
      database.prepare(
        "INSERT OR IGNORE INTO enrollments (user_id,course_id,payment_method,amount_minor,payment_status,paystack_reference) VALUES (?,?,?,?,?,?)"
      ).run(newUserId, courseId, methodName, Number(tx.amount), "paid", reference);
      database.prepare(`
        INSERT INTO paystack_transactions (reference,course_id,user_id,email,method,amount_minor,currency,status,created_at,verified_at,claimed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(reference) DO UPDATE SET
          status = 'claimed',
          user_id = excluded.user_id,
          verified_at = COALESCE(paystack_transactions.verified_at, excluded.verified_at),
          claimed_at = excluded.claimed_at
      `).run(reference, courseId, newUserId, customerEmail, methodName, Number(tx.amount), PAYMENT_CURRENCY, "claimed", now, now, now);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return {
      verified: true,
      enrolled: true,
      autoUserId: newUserId,
      user: { id: newUserId, name: buyerName, email: customerEmail },
      autoSignedIn: true,
      courseId,
      reference,
      method: methodName,
      amountMinor: Number(tx.amount),
      currency: PAYMENT_CURRENCY
    };
  }
  if (existingUser && (existingUser.has_password === 0 || (existingTx?.user_id && existingTx.user_id === existingUser.id))) {
    database.exec("BEGIN");
    try {
      database.prepare(
        "INSERT OR IGNORE INTO enrollments (user_id,course_id,payment_method,amount_minor,payment_status,paystack_reference) VALUES (?,?,?,?,?,?)"
      ).run(existingUser.id, courseId, methodName, Number(tx.amount), "paid", reference);
      database.prepare(`
        INSERT INTO paystack_transactions (reference,course_id,user_id,email,method,amount_minor,currency,status,created_at,verified_at,claimed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(reference) DO UPDATE SET
          status = 'claimed',
          user_id = excluded.user_id,
          verified_at = COALESCE(paystack_transactions.verified_at, excluded.verified_at),
          claimed_at = excluded.claimed_at
      `).run(reference, courseId, existingUser.id, customerEmail, methodName, Number(tx.amount), PAYMENT_CURRENCY, "claimed", now, now, now);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return {
      verified: true,
      enrolled: true,
      autoUserId: existingUser.id,
      user: { id: existingUser.id, name: existingUser.name, email: existingUser.email },
      autoSignedIn: true,
      courseId,
      reference,
      method: methodName,
      amountMinor: Number(tx.amount),
      currency: PAYMENT_CURRENCY
    };
  }

  const ticket = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + 30 * 60 * 1000;
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM payment_tickets WHERE paystack_reference = ? AND used_at IS NULL").run(reference);
    database.prepare(
      "INSERT INTO payment_tickets (token_hash,course_id,method,status,paystack_reference,amount_minor,expires_at) VALUES (?,?,?,?,?,?,?)"
    ).run(hashToken(ticket), courseId, methodName, "paid", reference, Number(tx.amount), expiresAt);
    database.prepare(`
      INSERT INTO paystack_transactions (reference,course_id,user_id,email,method,amount_minor,currency,status,created_at,verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(reference) DO UPDATE SET
        status = CASE WHEN paystack_transactions.status = 'claimed' THEN 'claimed' ELSE 'verified' END,
        verified_at = COALESCE(paystack_transactions.verified_at, excluded.verified_at)
    `).run(reference, courseId, null, customerEmail, methodName, Number(tx.amount), PAYMENT_CURRENCY, "verified", now, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { verified: true, enrolled: false, ticket, courseId, email: customerEmail, reference, method: methodName, amountMinor: Number(tx.amount), currency: PAYMENT_CURRENCY };
}

function cookieValue(request, name) {
  const cookie = request.headers.cookie || "";
  const pair = cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isHttpsRequest(request) {
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwardedProto === "https") return true;
  if (request?.socket?.encrypted) return true;
  const host = String(request?.headers?.host || "").toLowerCase();
  return host.endsWith(".run.app");
}

function sessionCookie(request, token, maxAge = SESSION_DAYS * 86400) {
  const attrs = isHttpsRequest(request)
    ? "SameSite=None; Secure; Partitioned"
    : "SameSite=Lax";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${attrs}; Max-Age=${maxAge}`;
}

function clearSessionCookie(request) {
  const attrs = isHttpsRequest(request)
    ? "SameSite=None; Secure; Partitioned"
    : "SameSite=Lax";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; ${attrs}; Max-Age=0`;
}

function currentSession(request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const session = database.prepare(
    "SELECT role,user_id FROM sessions WHERE token_hash = ? AND expires_at > ?"
  ).get(hashToken(token), Date.now());
  if (!session) return null;
  if (session.role === "admin") return { role: "admin" };
  const user = database.prepare("SELECT id,name,email FROM users WHERE id = ?").get(session.user_id);
  return user ? { ...user, role: "student" } : null;
}

function createSession(request, response, role, userId = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  database.prepare("INSERT INTO sessions (token_hash,user_id,role,expires_at) VALUES (?,?,?,?)")
    .run(hashToken(token), userId, role, expiresAt);
  response.setHeader("Set-Cookie", sessionCookie(request, token));
}

function requireStudent(request, response) {
  const session = currentSession(request);
  if (!session || session.role !== "student") {
    fail(response, 401, "Please sign in with a student account.", "AUTH_REQUIRED");
    return null;
  }
  return session;
}

function requireAdmin(request, response) {
  const session = currentSession(request);
  if (!session || session.role !== "admin") {
    fail(response, 401, "Admin sign-in is required.", "ADMIN_REQUIRED");
    return null;
  }
  return session;
}

function hasEnrollment(userId, courseId) {
  return Boolean(database.prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?")
    .get(userId, courseId));
}

function publicCourses() {
  return database.prepare(`
    SELECT c.id,c.title,c.subtitle,c.level,c.category,c.duration,c.image,c.price_minor,
      COUNT(l.id) AS lesson_count
    FROM courses c LEFT JOIN lessons l ON l.course_id = c.id
    GROUP BY c.id ORDER BY c.created_at,c.title
  `).all();
}

function publicCourse(courseId, user = null) {
  const course = database.prepare(
    "SELECT id,title,subtitle,level,category,duration,image,price_minor FROM courses WHERE id = ?"
  ).get(courseId);
  if (!course) return null;
  const lessons = database.prepare(
    "SELECT id,title,duration,video_file FROM lessons WHERE course_id = ? ORDER BY sort_order"
  ).all(courseId);
  course.lessons = lessons.map(lesson => ({
    id: lesson.id,
    title: lesson.title,
    duration: lesson.duration,
    videoUrl: user && hasEnrollment(user.id, courseId) && lesson.video_file ? `/api/videos/${lesson.id}` : null
  }));
  return course;
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function registerStudent(request, response, body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ticket = typeof body.ticket === "string" ? body.ticket : "";
  if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 200 || ticket.length < 20) {
    fail(response, 400, "Provide a valid name, email, password (at least 10 characters), and payment ticket.", "INVALID_INPUT");
    return;
  }
  const payment = database.prepare(
    "SELECT token_hash,course_id,method,status,paystack_reference,amount_minor FROM payment_tickets WHERE token_hash = ? AND status IN ('paid','demo_paid') AND used_at IS NULL AND expires_at > ?"
  ).get(hashToken(ticket), Date.now());
  if (!payment) {
    fail(response, 402, "A valid completed course payment is required before creating an account.", "PAYMENT_REQUIRED");
    return;
  }
  if (database.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    fail(response, 409, "An account already uses this email. Sign in to attach the paid course.", "ACCOUNT_EXISTS");
    return;
  }
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const now = Date.now();
  const paidCourse = database.prepare("SELECT price_minor FROM courses WHERE id = ?").get(payment.course_id);
  const ticketAmountMinor = Number(payment.amount_minor || paidCourse?.price_minor || PRICE_MINOR);
  database.exec("BEGIN");
  try {
    database.prepare("INSERT INTO users (id,name,email,salt,password_hash,has_password) VALUES (?,?,?,?,?,1)")
      .run(id, name, email, salt, passwordHash);
    database.prepare("INSERT INTO enrollments (user_id,course_id,payment_method,amount_minor,payment_status,paystack_reference) VALUES (?,?,?,?,?,?)")
      .run(id, payment.course_id, payment.method, ticketAmountMinor, payment.status, payment.paystack_reference || null);
    database.prepare("UPDATE payment_tickets SET used_at = ? WHERE token_hash = ?")
      .run(now, payment.token_hash);
    if (payment.paystack_reference) {
      database.prepare("UPDATE paystack_transactions SET status = 'claimed', claimed_at = ?, user_id = ? WHERE reference = ?")
        .run(now, id, payment.paystack_reference);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  createSession(request, response, "student", id);
  jsonResponse(response, 201, { user: { id, name, email }, enrolledCourseIds: [payment.course_id], paid: true });
}

async function loginStudent(request, response, body) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ticket = typeof body.ticket === "string" ? body.ticket : "";
  const user = database.prepare("SELECT id,name,email,salt,password_hash FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    fail(response, 401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
    return;
  }
  let addedCourseId = null;
  if (ticket) {
    const payment = database.prepare(
      "SELECT token_hash,course_id,method,status,paystack_reference,amount_minor FROM payment_tickets WHERE token_hash = ? AND status IN ('paid','demo_paid') AND used_at IS NULL AND expires_at > ?"
    ).get(hashToken(ticket), Date.now());
    if (!payment) {
      fail(response, 402, "The payment ticket is invalid or expired. Please start checkout again.", "PAYMENT_REQUIRED");
      return;
    }
    const now = Date.now();
    const paidCourse = database.prepare("SELECT price_minor FROM courses WHERE id = ?").get(payment.course_id);
    const ticketAmountMinor = Number(payment.amount_minor || paidCourse?.price_minor || PRICE_MINOR);
    database.exec("BEGIN");
    try {
      database.prepare("INSERT OR IGNORE INTO enrollments (user_id,course_id,payment_method,amount_minor,payment_status,paystack_reference) VALUES (?,?,?,?,?,?)")
        .run(user.id, payment.course_id, payment.method, ticketAmountMinor, payment.status, payment.paystack_reference || null);
      database.prepare("UPDATE payment_tickets SET used_at = ? WHERE token_hash = ?").run(now, payment.token_hash);
      if (payment.paystack_reference) {
        database.prepare("UPDATE paystack_transactions SET status = 'claimed', claimed_at = ?, user_id = ? WHERE reference = ?")
          .run(now, user.id, payment.paystack_reference);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    addedCourseId = payment.course_id;
  } else if (!database.prepare("SELECT 1 FROM enrollments WHERE user_id = ?").get(user.id)) {
    fail(response, 402, "Complete a course payment before signing in.", "PAYMENT_REQUIRED");
    return;
  }
  createSession(request, response, "student", user.id);
  const enrollments = database.prepare("SELECT course_id FROM enrollments WHERE user_id = ?").all(user.id).map(row => row.course_id);
  jsonResponse(response, 200, {
    user: { id: user.id, name: user.name, email: user.email },
    enrolledCourseIds: enrollments,
    addedCourseId,
    paid: Boolean(addedCourseId)
  });
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendFile(request, response, filePath, contentType) {
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      fail(response, 404, "File not found.", "NOT_FOUND");
      return;
    }
    const range = request.headers.range;
    if (range && contentType.startsWith("video/")) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        response.end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
      });
      fs.createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": contentType.startsWith("video/") ? "private, no-store" : "no-cache",
      ...(contentType.startsWith("video/") ? { "Accept-Ranges": "bytes" } : {})
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function handleVideo(request, response, lessonId) {
  const user = requireStudent(request, response);
  if (!user) return;
  const lesson = database.prepare("SELECT course_id,video_file FROM lessons WHERE id = ?").get(lessonId);
  if (!lesson || !lesson.video_file || !hasEnrollment(user.id, lesson.course_id)) {
    fail(response, 404, "Video not found.", "NOT_FOUND");
    return;
  }
  const filePath = path.join(VIDEO_DIR, path.basename(lesson.video_file));
  const extension = path.extname(filePath).toLowerCase();
  sendFile(request, response, filePath, MIME_TYPES[extension] || "application/octet-stream");
}

async function addAdminLesson(request, response, courseId, createCourse = false) {
  if (!requireAdmin(request, response)) return;
  let form;
  try {
    const chunks = [];
    let size = 0;
    const maxRequestBytes = MAX_VIDEO_BYTES + 1024 * 1024;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxRequestBytes) {
        fail(response, 413, "Video must be smaller than 100 MB.", "VIDEO_TOO_LARGE");
        return;
      }
      chunks.push(chunk);
    }
    const webRequest = new Request(`http://${request.headers.host}${request.url}`, {
      method: "POST",
      headers: request.headers,
      body: Buffer.concat(chunks)
    });
    form = await webRequest.formData();
  } catch {
    fail(response, 400, "Could not read the upload. Check the form fields and video file.", "INVALID_UPLOAD");
    return;
  }
  const title = String(form.get("title") || "").trim();
  const quiz = String(form.get("question") || "").trim();
  const choices = [1, 2, 3].map(index => String(form.get(`choice${index}`) || "").trim());
  const answer = Number(form.get("answer"));
  const file = form.get("video");
  if (title.length < 2 || title.length > 160 || quiz.length < 5 || choices.some(choice => !choice) || !Number.isInteger(answer) || answer < 0 || answer > 2 || !(file instanceof File) || !file.size) {
    fail(response, 400, "Add a lesson title, quiz, three answers, correct answer, and a video.", "INVALID_UPLOAD");
    return;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    fail(response, 413, "Video must be smaller than 100 MB.", "VIDEO_TOO_LARGE");
    return;
  }
  if (!file.type.startsWith("video/")) {
    fail(response, 415, "Choose a supported video file.", "INVALID_VIDEO");
    return;
  }
  let course = courseId ? database.prepare("SELECT id FROM courses WHERE id = ?").get(courseId) : null;
  let newCourse = null;
  if (courseId && !course) {
    fail(response, 404, "Course not found.", "NOT_FOUND");
    return;
  }
  if (!courseId) {
    const courseTitle = String(form.get("courseTitle") || "").trim();
    const level = String(form.get("level") || "").trim();
    const priceMinor = parsePriceMinor(form.get("price"));
    if (courseTitle.length < 2 || courseTitle.length > 160 || level.length < 2 || level.length > 40) {
      fail(response, 400, "Enter a course title (2–160 characters) and a learning level (2–40 characters).", "INVALID_COURSE");
      return;
    }
    if (!priceMinor) {
      fail(response, 400, "Enter a valid course price in GHS (between 1.00 and 100,000.00).", "INVALID_PRICE");
      return;
    }
    const subtitle = String(form.get("subtitle") || "A guided architecture design course.").trim();
    const category = String(form.get("category") || "Studio course").trim();
    const imageInput = String(form.get("image") || "").trim();
    let image = "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80";
    if (imageInput.length > 2048) {
      fail(response, 400, "Course image URL must be shorter than 2048 characters.", "INVALID_COURSE");
      return;
    }
    if (imageInput) {
      try {
        const imageUrl = new URL(imageInput);
        if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error("Unsupported image URL protocol.");
        image = imageUrl.href;
      } catch {
        fail(response, 400, "Course image must be a valid HTTP or HTTPS URL.", "INVALID_COURSE");
        return;
      }
    }
    if (subtitle.length < 2 || subtitle.length > 240 || category.length < 2 || category.length > 80) {
      fail(response, 400, "Keep the course description under 240 characters and category between 2 and 80 characters.", "INVALID_COURSE");
      return;
    }
    const existing = database.prepare("SELECT id FROM courses WHERE title = ? COLLATE NOCASE").get(courseTitle);
    if (createCourse && existing) {
      fail(response, 409, "A course with that title already exists.", "COURSE_EXISTS");
      return;
    }
    if (!createCourse && existing) course = existing;
    else {
      const id = `course-${crypto.randomUUID()}`;
      newCourse = { id, title: courseTitle, subtitle, level, category, image, priceMinor };
      course = { id };
    }
  }
  const extensionByType = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };
  const extension = extensionByType[file.type];
  if (!extension) {
    fail(response, 415, "Supported video formats are MP4, WebM, and MOV.", "INVALID_VIDEO");
    return;
  }
  const lessonId = crypto.randomUUID();
  const filename = `${lessonId}${extension}`;
  const destination = path.join(VIDEO_DIR, filename);
  try {
    await fs.promises.writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    database.exec("BEGIN");
    if (newCourse) {
      database.prepare("INSERT INTO courses (id,title,subtitle,level,category,duration,image,price_minor) VALUES (?,?,?,?,?,?,?,?)")
        .run(newCourse.id, newCourse.title, newCourse.subtitle, newCourse.level, newCourse.category, "1 lesson", newCourse.image, newCourse.priceMinor);
    }
    const last = database.prepare("SELECT COALESCE(MAX(sort_order), -1) AS last FROM lessons WHERE course_id = ?").get(course.id).last;
    database.prepare("INSERT INTO lessons (id,course_id,title,duration,quiz,choices_json,answer_index,video_file,sort_order) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(lessonId, course.id, title, `${Math.max(1, Math.round(file.size / 1000000))} MB`, quiz, JSON.stringify(choices), answer, filename, last + 1);
    const lessonCount = database.prepare("SELECT COUNT(*) AS count FROM lessons WHERE course_id = ?").get(course.id).count;
    database.prepare("UPDATE courses SET duration = ? WHERE id = ?")
      .run(`${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`, course.id);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  }
  jsonResponse(response, 201, { courseId: course.id, lessonId, title });
}

async function api(request, response, url) {
  const method = request.method;
  const pathname = url.pathname;
  const session = currentSession(request);

  if (method === "GET" && pathname === "/api/courses") {
    jsonResponse(response, 200, { courses: publicCourses() });
    return;
  }
  if (method === "GET" && pathname === "/api/me") {
    if (!session || session.role !== "student") {
      jsonResponse(response, 200, { user: null, enrolledCourseIds: [] });
      return;
    }
    const enrolledCourseIds = database.prepare("SELECT course_id FROM enrollments WHERE user_id = ?")
      .all(session.id).map(row => row.course_id);
    jsonResponse(response, 200, { user: { id: session.id, name: session.name, email: session.email }, enrolledCourseIds });
    return;
  }
  if (method === "GET" && pathname === "/api/admin/session") {
    jsonResponse(response, 200, { isAdmin: session?.role === "admin" });
    return;
  }
  if (method === "GET" && pathname === "/api/admin/courses") {
    if (!requireAdmin(request, response)) return;
    jsonResponse(response, 200, { courses: publicCourses() });
    return;
  }
  if (method === "POST" && pathname === "/api/admin/courses") {
    await addAdminLesson(request, response, null, true);
    return;
  }
  if (method === "POST" && pathname === "/api/checkout/initialize") {
    const body = await readJson(request);
    const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
    const methodName = typeof body.method === "string" ? body.method.trim() : "";
    const user = session?.role === "student" ? session : null;
    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const email = user ? user.email.toLowerCase() : rawEmail;
    const course = database.prepare("SELECT id,title,price_minor FROM courses WHERE id = ?").get(courseId);
    if (!course) {
      fail(response, 404, "Course not found.", "NOT_FOUND");
      return;
    }
    const coursePriceMinor = Number(course.price_minor) > 0 ? Number(course.price_minor) : PRICE_MINOR;
    const channels = paystackChannelsForMethod(methodName);
    if (!channels) {
      fail(response, 400, "Choose MTN MoMo, Telecel Cash, or Visa.", "INVALID_PAYMENT_METHOD");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail(response, 400, "Enter a valid email address for your payment receipt.", "INVALID_EMAIL");
      return;
    }
    if (user && hasEnrollment(user.id, courseId)) {
      fail(response, 409, "You are already enrolled in this course.", "ALREADY_ENROLLED");
      return;
    }
    const reference = `BR-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
    const callbackUrl = `${callbackBaseUrl(request)}/api/checkout/callback`;
    const paystackData = await paystackApi("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email,
        amount: coursePriceMinor,
        currency: PAYMENT_CURRENCY,
        reference,
        channels,
        callback_url: callbackUrl,
        metadata: {
          courseId: course.id,
          courseTitle: course.title,
          method: methodName,
          userId: user ? user.id : null
        }
      })
    });
    database.prepare(`
      INSERT INTO paystack_transactions (reference,course_id,user_id,email,method,amount_minor,currency,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(reference, course.id, user ? user.id : null, email, methodName, coursePriceMinor, PAYMENT_CURRENCY, "pending", Date.now());
    jsonResponse(response, 200, {
      reference,
      accessCode: paystackData.access_code,
      authorizationUrl: paystackData.authorization_url,
      amountMinor: coursePriceMinor,
      currency: PAYMENT_CURRENCY,
      email
    });
    return;
  }
  if (method === "GET" && (pathname === "/api/checkout/callback" || pathname === "/paystack/callback")) {
    const reference = String(url.searchParams.get("reference") || url.searchParams.get("trxref") || "").trim();
    if (!reference || reference.length > 120) {
      response.writeHead(302, { Location: `/?payment_error=${encodeURIComponent("Missing Paystack payment reference.")}` });
      response.end();
      return;
    }
    try {
      const result = await verifyPaystackReference(reference, session);
      if (result.autoUserId) {
        createSession(request, response, "student", result.autoUserId);
      }
      const location = result.enrolled
        ? `/programs/${encodeURIComponent(result.courseId)}?payment=success&reference=${encodeURIComponent(reference)}`
        : `/programs/${encodeURIComponent(result.courseId)}?reference=${encodeURIComponent(reference)}`;
      response.writeHead(302, { Location: location });
      response.end();
    } catch (error) {
      const targetPath = error.courseId ? `/programs/${encodeURIComponent(error.courseId)}` : "/";
      response.writeHead(302, { Location: `${targetPath}?payment_error=${encodeURIComponent(error.message)}&reference=${encodeURIComponent(reference)}` });
      response.end();
    }
    return;
  }
  if (method === "POST" && pathname === "/api/checkout/verify") {
    const body = await readJson(request);
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!reference || reference.length > 120) {
      fail(response, 400, "A valid payment reference is required.", "INVALID_REFERENCE");
      return;
    }
    const result = await verifyPaystackReference(reference, session);
    if (result.autoUserId) {
      createSession(request, response, "student", result.autoUserId);
      delete result.autoUserId;
    }
    jsonResponse(response, 200, result);
    return;
  }
  if (method === "POST" && pathname === "/api/webhooks/paystack") {
    if (!PAYSTACK_SECRET_KEY) {
      fail(response, 503, "Paystack is not configured.", "PAYSTACK_NOT_CONFIGURED");
      return;
    }
    const signature = String(request.headers["x-paystack-signature"] || "");
    const rawBody = await readRawBody(request);
    const expected = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
    if (!signature || !safeEqualText(signature, expected)) {
      fail(response, 401, "Invalid Paystack webhook signature.", "INVALID_SIGNATURE");
      return;
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      fail(response, 400, "Invalid JSON payload.", "INVALID_JSON");
      return;
    }
    if (event?.event === "charge.success" && event?.data) {
      const tx = event.data;
      const reference = String(tx.reference || "").trim();
      const existingTx = reference ? database.prepare("SELECT * FROM paystack_transactions WHERE reference = ?").get(reference) : null;
      const courseId = existingTx?.course_id || String(tx.metadata?.courseId || "");
      const course = courseId ? database.prepare("SELECT id,price_minor FROM courses WHERE id = ?").get(courseId) : null;
      const expectedAmountMinor = Number(existingTx?.amount_minor || course?.price_minor || PRICE_MINOR);
      if (reference && course && tx.status === "success" && String(tx.currency || "").toUpperCase() === PAYMENT_CURRENCY && Number(tx.amount) >= expectedAmountMinor) {
        const methodName = existingTx?.method || String(tx.metadata?.method || (tx.channel === "mobile_money" ? "MTN MoMo" : "Visa"));
        const customerEmail = String(tx.customer?.email || existingTx?.email || "").trim().toLowerCase();
        const userId = existingTx?.user_id || tx.metadata?.userId || null;
        const validUser = userId ? database.prepare("SELECT id FROM users WHERE id = ?").get(userId) : null;
        const now = Date.now();
        database.exec("BEGIN");
        try {
          if (validUser) {
            database.prepare(
              "INSERT OR IGNORE INTO enrollments (user_id,course_id,payment_method,amount_minor,payment_status,paystack_reference) VALUES (?,?,?,?,?,?)"
            ).run(validUser.id, course.id, methodName, Number(tx.amount), "paid", reference);
          }
          database.prepare(`
            INSERT INTO paystack_transactions (reference,course_id,user_id,email,method,amount_minor,currency,status,created_at,verified_at,claimed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(reference) DO UPDATE SET
              status = CASE WHEN excluded.status = 'claimed' OR paystack_transactions.status = 'claimed' THEN 'claimed' ELSE 'verified' END,
              verified_at = COALESCE(paystack_transactions.verified_at, excluded.verified_at),
              claimed_at = COALESCE(paystack_transactions.claimed_at, excluded.claimed_at)
          `).run(reference, course.id, validUser ? validUser.id : null, customerEmail, methodName, Number(tx.amount), PAYMENT_CURRENCY, validUser ? "claimed" : "verified", now, now, validUser ? now : null);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }
    }
    jsonResponse(response, 200, { received: true });
    return;
  }
  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson(request);
    await registerStudent(request, response, body);
    return;
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(request);
    await loginStudent(request, response, body);
    return;
  }
  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    jsonResponse(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(request) });
    return;
  }
  if (method === "POST" && pathname === "/api/admin/login") {
    const body = await readJson(request);
    if (!safeEqualText(body.password || "", adminPassword)) {
      fail(response, 401, "Admin password is incorrect.", "INVALID_CREDENTIALS");
      return;
    }
    createSession(request, response, "admin");
    jsonResponse(response, 200, { ok: true });
    return;
  }
  const courseMatch = /^\/api\/courses\/([^/]+)$/.exec(pathname);
  if (method === "GET" && courseMatch) {
    const course = publicCourse(decodeURIComponent(courseMatch[1]), session?.role === "student" ? session : null);
    if (!course) {
      fail(response, 404, "Course not found.", "NOT_FOUND");
      return;
    }
    jsonResponse(response, 200, { course });
    return;
  }
  const courseProgressMatch = /^\/api\/courses\/([^/]+)\/progress$/.exec(pathname);
  if (method === "GET" && courseProgressMatch) {
    const user = requireStudent(request, response);
    if (!user) return;
    const courseId = decodeURIComponent(courseProgressMatch[1]);
    if (!hasEnrollment(user.id, courseId)) {
      fail(response, 403, "Payment is required to access this course.", "PAYMENT_REQUIRED");
      return;
    }
    const completedLessonIds = database.prepare(`
      SELECT p.lesson_id FROM progress p
      JOIN lessons l ON l.id = p.lesson_id
      WHERE p.user_id = ? AND l.course_id = ?
    `).all(user.id, courseId).map(row => row.lesson_id);
    jsonResponse(response, 200, { completedLessonIds });
    return;
  }
  const lessonMatch = /^\/api\/lessons\/([^/]+)$/.exec(pathname);
  if (method === "GET" && lessonMatch) {
    const user = requireStudent(request, response);
    if (!user) return;
    const lesson = database.prepare(`
      SELECT l.id,l.course_id,l.title,l.duration,l.quiz,l.choices_json,l.video_file,l.sort_order,c.title AS course_title
      FROM lessons l JOIN courses c ON c.id = l.course_id
      WHERE l.id = ?
    `).get(decodeURIComponent(lessonMatch[1]));
    if (!lesson || !hasEnrollment(user.id, lesson.course_id)) {
      fail(response, 404, "Lesson not found.", "NOT_FOUND");
      return;
    }
    const previous = database.prepare(`
      SELECT COUNT(*) AS count FROM lessons l
      WHERE l.course_id = ? AND l.sort_order < ?
        AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.user_id = ?)
    `).get(lesson.course_id, lesson.sort_order, user.id).count;
    if (previous > 0) {
      fail(response, 403, "Complete the previous lesson quiz first.", "LESSON_LOCKED");
      return;
    }
    jsonResponse(response, 200, {
      lesson: {
        id: lesson.id,
        title: lesson.title,
        duration: lesson.duration,
        quiz: lesson.quiz,
        choices: JSON.parse(lesson.choices_json),
        courseTitle: lesson.course_title,
        videoUrl: lesson.video_file ? `/api/videos/${lesson.id}` : null
      }
    });
    return;
  }
  const videoMatch = /^\/api\/videos\/([^/]+)$/.exec(pathname);
  if (method === "GET" && videoMatch) {
    await handleVideo(request, response, decodeURIComponent(videoMatch[1]));
    return;
  }
  const quizMatch = /^\/api\/lessons\/([^/]+)\/quiz$/.exec(pathname);
  if (method === "POST" && quizMatch) {
    const user = requireStudent(request, response);
    if (!user) return;
    const lesson = database.prepare("SELECT id,course_id,answer_index,sort_order FROM lessons WHERE id = ?")
      .get(decodeURIComponent(quizMatch[1]));
    if (!lesson || !hasEnrollment(user.id, lesson.course_id)) {
      fail(response, 404, "Lesson not found.", "NOT_FOUND");
      return;
    }
    const body = await readJson(request);
    if (!Number.isInteger(body.answer)) {
      fail(response, 400, "Choose an answer.", "INVALID_ANSWER");
      return;
    }
    const previous = database.prepare(`
      SELECT COUNT(*) AS count FROM lessons l
      WHERE l.course_id = ? AND l.sort_order < ?
        AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.user_id = ?)
    `).get(lesson.course_id, lesson.sort_order, user.id).count;
    if (previous > 0) {
      fail(response, 403, "Complete the previous lesson quiz first.", "LESSON_LOCKED");
      return;
    }
    const correct = body.answer === lesson.answer_index;
    if (correct) database.prepare("INSERT OR IGNORE INTO progress (user_id,lesson_id) VALUES (?,?)").run(user.id, lesson.id);
    jsonResponse(response, 200, { correct, completed: correct });
    return;
  }
  const adminCourseMatch = /^\/api\/admin\/courses\/([^/]+)\/lessons$/.exec(pathname);
  if (method === "POST" && adminCourseMatch) {
    await addAdminLesson(request, response, decodeURIComponent(adminCourseMatch[1]));
    return;
  }
  const adminCourseMatchForUpdate = /^\/api\/admin\/courses\/([^/]+)$/.exec(pathname);
  if (method === "PATCH" && adminCourseMatchForUpdate) {
    if (!requireAdmin(request, response)) return;
    const courseId = decodeURIComponent(adminCourseMatchForUpdate[1]);
    const existingCourse = database.prepare("SELECT id,level,price_minor FROM courses WHERE id = ?").get(courseId);
    if (!existingCourse) {
      fail(response, 404, "Course not found.", "NOT_FOUND");
      return;
    }
    const body = await readJson(request);
    const level = typeof body.level === "string" ? body.level.trim() : existingCourse.level;
    const priceMinor = body.price !== undefined ? parsePriceMinor(body.price) : existingCourse.price_minor;
    if (!level || level.length < 2 || level.length > 40) {
      fail(response, 400, "Enter a learning level between 2 and 40 characters.", "INVALID_COURSE");
      return;
    }
    if (!priceMinor) {
      fail(response, 400, "Enter a valid course price in GHS (between 1.00 and 100,000.00).", "INVALID_PRICE");
      return;
    }
    database.prepare("UPDATE courses SET level = ?, price_minor = ? WHERE id = ?").run(level, priceMinor, courseId);
    jsonResponse(response, 200, { course: publicCourse(courseId) });
    return;
  }
  const adminCourseMatchForDelete = /^\/api\/admin\/courses\/([^/]+)$/.exec(pathname);
  if (method === "DELETE" && adminCourseMatchForDelete) {
    if (!requireAdmin(request, response)) return;
    const courseId = decodeURIComponent(adminCourseMatchForDelete[1]);
    const course = database.prepare("SELECT id FROM courses WHERE id = ?").get(courseId);
    if (!course) {
      fail(response, 404, "Course not found.", "NOT_FOUND");
      return;
    }
    const videos = database.prepare("SELECT video_file FROM lessons WHERE course_id = ? AND video_file IS NOT NULL")
      .all(courseId).map(row => row.video_file);
    database.exec("BEGIN");
    try {
      database.prepare("DELETE FROM payment_tickets WHERE course_id = ?").run(courseId);
      database.prepare("DELETE FROM courses WHERE id = ?").run(courseId);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
    const cleanupWarnings = [];
    for (const filename of videos) {
      if (filename !== path.basename(filename)) {
        cleanupWarnings.push(`Could not safely remove video ${filename}.`);
        continue;
      }
      const videoPath = path.resolve(VIDEO_DIR, path.basename(filename));
      if (!videoPath.startsWith(`${VIDEO_DIR}${path.sep}`)) {
        cleanupWarnings.push(`Could not safely remove video ${filename}.`);
        continue;
      }
      try {
        await fs.promises.unlink(videoPath);
      } catch (error) {
        if (error.code !== "ENOENT") cleanupWarnings.push(`Could not remove video ${filename}: ${error.message}`);
      }
    }
    jsonResponse(response, 200, { deleted: true, cleanupWarnings });
    return;
  }
  if (method === "POST" && pathname === "/api/admin/lessons") {
    await addAdminLesson(request, response, null);
    return;
  }
  fail(response, 404, "API route not found.", "NOT_FOUND");
}

function staticFile(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    fail(response, 400, "Invalid URL.", "INVALID_URL");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/b-render-logo.png" || pathname === "/favicon.ico") pathname = "/assets/b-render-logo.png";
  if (!["/index.html", "/styles.css", "/app.js", "/assets/b-render-logo.png"].includes(pathname)) {
    const applicationRoute = ["/about", "/programs", "/news", "/student/dashboard", "/admin/dashboard"].includes(pathname) ||
      /^\/programs\/[a-zA-Z0-9_-]+$/.test(pathname);
    if (applicationRoute) pathname = "/index.html";
    else {
      fail(response, 404, "File not found.", "NOT_FOUND");
      return;
    }
  }
  const candidate = path.resolve(ROOT, `.${pathname}`);
  if (!candidate.startsWith(`${ROOT}${path.sep}`) || pathname.startsWith("/api/")) {
    fail(response, 404, "File not found.", "NOT_FOUND");
    return;
  }
  const extension = path.extname(candidate).toLowerCase();
  const contentType = MIME_TYPES[extension];
  if (!contentType) {
    fail(response, 404, "File not found.", "NOT_FOUND");
    return;
  }
  sendFile(request, response, candidate, contentType);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/paystack/callback") {
      await api(request, response, url);
    } else if (request.method === "GET" || request.method === "HEAD") {
      staticFile(request, response, url);
    } else {
      fail(response, 405, "Method not allowed.", "METHOD_NOT_ALLOWED");
    }
  } catch (error) {
    console.error(`${request.method} ${url.pathname}:`, error);
    if (!response.headersSent) fail(response, error.status || 500, error.status ? error.message : "The server could not complete the request.", error.code || "SERVER_ERROR");
    else response.destroy(error);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`B Render Family Architecture Academy running at http://localhost:${PORT}`);
  if (!PAYSTACK_SECRET_KEY) {
    console.warn("PAYSTACK_SECRET_KEY is not set. Checkout initialization will return 503 until configured.");
  }
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
