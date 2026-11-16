const imageFallback = "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80";
const grid = document.getElementById("course-grid");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalContent = document.getElementById("modal-content");
const toast = document.getElementById("toast");
let courses = [];
let student = null;
let enrolledCourseIds = [];
let courseProgressMap = new Map();
let activeCourseId = null;
let selectedPayment = "MTN MoMo";
let pendingPaymentTicket = null;
let toastTimer;
let displayedCalendar = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let routeRenderId = 0;
const routePage = document.createElement("section");
routePage.className = "route-page";
routePage.id = "route-page";
document.querySelector("main").prepend(routePage);

function formatCoursePrice(priceMinor, currency = "GHS", { decimals = true } = {}) {
  const minor = Number(priceMinor) > 0 ? Number(priceMinor) : 18000;
  const amount = minor / 100;
  if (!decimals && Number.isInteger(amount)) return `${currency} ${amount}`;
  return `${currency} ${amount.toFixed(2)}`;
}

function renderCoursePriceRow(course) {
  const enrolled = isEnrolled(course.id);
  return `
    <div class="course-card-price">
      <div class="course-price-copy">
        <span>Course fee</span>
        <strong>${escapeHTML(formatCoursePrice(course.price_minor))}</strong>
      </div>
      <button class="course-enroll-btn${enrolled ? " is-enrolled" : ""}" type="button" data-card-enroll="${escapeHTML(course.id)}">
        ${enrolled ? "Open course ↗" : "Enroll now ↗"}
      </button>
    </div>
  `;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "The request could not be completed.");
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showToast(message, type = "info", options = {}) {
  const validType = ["success", "error", "warning", "info"].includes(type) ? type : "info";
  const icons = { success: "✓", error: "!", warning: "⚠", info: "i" };
  const title = options.title || "";
  const duration = Number.isFinite(options.duration)
    ? options.duration
    : validType === "error" || validType === "success" ? 4800 : 3400;

  toast.className = `toast toast-${validType}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[validType]}</span>
    <div class="toast-copy">
      ${title ? `<span class="toast-title">${escapeHTML(title)}</span>` : ""}
      <span class="toast-message">${escapeHTML(message)}</span>
    </div>
    <button class="toast-close" type="button" aria-label="Dismiss notification">×</button>
  `;
  toast.querySelector(".toast-close")?.addEventListener("click", () => {
    toast.classList.remove("visible");
    clearTimeout(toastTimer);
  });
  requestAnimationFrame(() => toast.classList.add("visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), duration);
}

function openModal(html, variant = "default") {
  const modalEl = document.getElementById("modal");
  modalContent.innerHTML = html;
  modalBackdrop.classList.toggle("auth-backdrop", variant === "auth");
  modalBackdrop.classList.toggle("academy-learning-backdrop", variant === "academy");
  modalBackdrop.classList.toggle("payment-status-backdrop", variant === "payment-success" || variant === "payment-error");
  modalBackdrop.classList.toggle("payment-form-backdrop", variant === "payment-form");
  modalEl.classList.toggle("auth-modal", variant === "auth");
  modalEl.classList.toggle("academy-learning-modal", variant === "academy");
  modalEl.classList.toggle("payment-status-modal", variant === "payment-success" || variant === "payment-error");
  modalEl.classList.toggle("payment-form-modal", variant === "payment-form");
  modalEl.classList.toggle("is-success", variant === "payment-success");
  modalEl.classList.toggle("is-error", variant === "payment-error");
  modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("modal-close").focus();
}

function closeModal() {
  const modalEl = document.getElementById("modal");
  modalBackdrop.hidden = true;
  modalBackdrop.classList.remove("auth-backdrop", "academy-learning-backdrop", "payment-status-backdrop", "payment-form-backdrop");
  modalEl.classList.remove("auth-modal", "academy-learning-modal", "payment-status-modal", "payment-form-modal", "is-success", "is-error");
  document.body.style.overflow = "";
  activeCourseId = null;
}

function isEnrolled(courseId) {
  return enrolledCourseIds.includes(courseId);
}

function getCourseProgress(course) {
  const courseId = typeof course === "string" ? course : course.id;
  const courseObj = typeof course === "string" ? courses.find(c => c.id === courseId) : course;
  const total = Number(courseObj?.lesson_count || (courseObj?.lessons ? courseObj.lessons.length : 0)) || 1;

  if (!student || !isEnrolled(courseId)) {
    return {
      enrolled: false,
      completedCount: 0,
      totalCount: total,
      percent: 0,
      label: student ? "Not enrolled" : "Available",
      status: "unstarted"
    };
  }

  const progress = courseProgressMap.get(courseId);
  const completed = progress ? progress.completedCount : 0;
  const percent = Math.min(100, Math.round((completed / total) * 100));

  let label = `${completed}/${total} lessons`;
  let status = "in-progress";
  if (percent === 100) {
    label = "Completed";
    status = "completed";
  } else if (percent === 0) {
    label = "Enrolled";
    status = "enrolled";
  }

  return {
    enrolled: true,
    completedCount: completed,
    totalCount: total,
    percent,
    label,
    status
  };
}

function renderCourseProgressBar(course) {
  const prog = getCourseProgress(course);
  return `
    <div class="course-card-progress" data-course-progress="${escapeHTML(course.id)}">
      <div class="course-progress-header">
        <span class="course-progress-badge ${prog.status}">${escapeHTML(prog.label)}</span>
        <span class="course-progress-percent">${prog.percent}%</span>
      </div>
      <div class="course-progress-track" role="progressbar" aria-valuenow="${prog.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHTML(course.title)} completion: ${prog.percent}%">
        <div class="course-progress-fill ${prog.status}" data-target-width="${prog.percent}%" style="width: 0%;"></div>
      </div>
      <div class="course-progress-subtext">
        <span>${prog.percent === 100 ? "All lessons completed" : `${prog.completedCount} of ${prog.totalCount} lessons completed`}</span>
      </div>
    </div>
  `;
}

function animateCourseProgressBars(container) {
  if (!container) return;
  const fills = container.querySelectorAll(".course-progress-fill[data-target-width]");
  if (!fills.length) return;
  void container.offsetWidth;
  requestAnimationFrame(() => {
    fills.forEach(fill => {
      fill.style.width = fill.dataset.targetWidth;
    });
  });
}

async function refreshUserProgress() {
  if (!student || !enrolledCourseIds.length) {
    courseProgressMap.clear();
    return;
  }
  const enrolledCourses = courses.filter(course => isEnrolled(course.id));
  await Promise.all(enrolledCourses.map(async course => {
    try {
      const progress = await api(`/api/courses/${encodeURIComponent(course.id)}/progress`);
      const completedCount = progress.completedLessonIds.length;
      const totalCount = Number(course.lesson_count || (course.lessons ? course.lessons.length : 0)) || 1;
      const percent = Math.min(100, Math.round((completedCount / totalCount) * 100));
      courseProgressMap.set(course.id, {
        completedCount,
        totalCount,
        percent,
        completedLessonIds: progress.completedLessonIds
      });
    } catch (err) {}
  }));
}

function updateSignInButton() {
  document.getElementById("sign-in-open").textContent = student ? student.name.split(/\s+/)[0] : "Sign in";
  const profileName = document.getElementById("profile-name");
  if (profileName) profileName.textContent = student ? student.name : "B Render Academy learner";
  const initials = student
    ? student.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()
    : "F";
  const profileAvatar = document.getElementById("profile-avatar");
  if (profileAvatar) profileAvatar.textContent = initials;
  const heroAvatar = document.getElementById("hero-avatar");
  if (heroAvatar) heroAvatar.textContent = initials;
  if (courses.length) renderCourses();
}

function renderHeroFeaturedCourse() {
  const course = courses[0];
  const card = document.getElementById("hero-featured-course");
  if (!course) {
    card.hidden = true;
    card.removeAttribute("href");
    card.innerHTML = "";
    document.getElementById("hero-course-count").textContent = "00";
    return;
  }
  card.hidden = false;
  card.href = `/programs/${encodeURIComponent(course.id)}`;
  card.dataset.route = card.getAttribute("href");
  card.innerHTML = `
    <img class="featured-course-image" src="${escapeHTML(course.image || imageFallback)}" alt="" />
    <div class="featured-course-copy">
      <span class="university-eyebrow">FEATURED COURSE · ${escapeHTML(formatCoursePrice(course.price_minor, "GHS", { decimals: false }))}</span>
      <h2>${escapeHTML(course.title)}</h2>
      <p>${escapeHTML(course.duration || `${course.lesson_count || 0} lessons`)} · Architecture academy</p>
    </div>
    <span class="featured-course-arrow" aria-hidden="true">↗</span>
  `;
  document.getElementById("hero-course-count").textContent = `${String(courses.length).padStart(2, "0")}+`;
}

function renderCourses() {
  const searchInput = document.getElementById("course-search");
  const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const filtered = courses.filter(course =>
    !search || `${course.title} ${course.category} ${course.subtitle} ${course.level}`.toLowerCase().includes(search)
  );
  const count = filtered.length;

  const visibleCountEl = document.getElementById("course-visible-count");
  if (visibleCountEl) {
    if (count === 0) {
      visibleCountEl.innerHTML = `No courses found${search ? ` matching &ldquo;<strong>${escapeHTML(search)}</strong>&rdquo;` : ""}`;
    } else {
      const filterText = search ? ` matching &ldquo;<strong>${escapeHTML(search)}</strong>&rdquo;` : "";
      visibleCountEl.innerHTML = `Showing <strong>${count}</strong> course${count === 1 ? "" : "s"} visible${filterText}`;
    }
  }

  const bottomCountEl = document.getElementById("course-count");
  if (bottomCountEl) {
    bottomCountEl.textContent = `${String(count).padStart(2, "0")} classes`;
  }

  grid.innerHTML = filtered.length ? filtered.map((course, index) => `
    <article class="course-card tile-tone-${index % 3}" tabindex="0" role="button" aria-label="Open ${escapeHTML(course.title)} class" data-course="${escapeHTML(course.id)}">
      <div class="course-image">
        <img src="${escapeHTML(course.image || imageFallback)}" alt="" loading="lazy" />
        <span class="course-arrow" aria-hidden="true">↗</span>
      </div>
      <div class="course-meta"><span>${escapeHTML(course.category || "Studio course")}</span><span>${escapeHTML(course.lesson_count || 0)} lessons</span></div>
      <h3>${escapeHTML(course.title)}</h3>
      ${renderCoursePriceRow(course)}
    </article>
  `).join("") : `<div class="empty-state">No matching classes. Try another search.</div>`;
  renderReminders();
  grid.querySelectorAll(".course-card").forEach(card => {
    card.addEventListener("click", () => navigate(`/programs/${encodeURIComponent(card.dataset.course)}`));
    card.addEventListener("keydown", event => {
      if (event.target.closest("[data-card-enroll]")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate(`/programs/${encodeURIComponent(card.dataset.course)}`);
      }
    });
  });
  grid.querySelectorAll("[data-card-enroll]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openCourse(button.dataset.cardEnroll);
    });
  });
  document.querySelectorAll("[data-course-reminder]").forEach(button => {
    button.addEventListener("click", () => navigate(`/programs/${encodeURIComponent(button.dataset.courseReminder)}`));
  });
}

function renderReminders() {
  const list = document.getElementById("reminder-list");
  list.innerHTML = courses.slice(0, 3).map(course => `
    <button class="reminder-item" type="button" data-course-reminder="${escapeHTML(course.id)}">
      <span class="reminder-icon" aria-hidden="true">▷</span>
      <span class="reminder-copy"><strong>${escapeHTML(course.title)}</strong><small>${escapeHTML(course.level)} · ${escapeHTML(course.duration || "Self-paced")}</small></span>
      <span class="reminder-arrow" aria-hidden="true">›</span>
    </button>
  `).join("") || `<p class="reminder-empty">Your class recommendations will show up here.</p>`;
}

function renderCalendar() {
  const year = displayedCalendar.getFullYear();
  const month = displayedCalendar.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  document.getElementById("calendar-month").textContent = displayedCalendar.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
  const days = [
    ...Array.from({ length: firstWeekday }, () => `<span class="calendar-day is-empty" aria-hidden="true"></span>`),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
      return `<span class="calendar-day${isToday ? " is-today" : ""}"${isToday ? ' aria-current="date"' : ""}>${day}</span>`;
    })
  ];
  document.getElementById("calendar-days").innerHTML = days.join("");
}

function navigate(path) {
  const destination = new URL(path, window.location.origin);
  if (`${window.location.pathname}${window.location.search}` !== `${destination.pathname}${destination.search}`) {
    history.pushState({}, "", destination);
  }
  renderRoute();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function routeHeader(title, kicker, description) {
  return `
    <div class="route-heading">
      <span class="university-eyebrow">${escapeHTML(kicker)}</span>
      <h1>${escapeHTML(title)}</h1>
      <p>${escapeHTML(description)}</p>
    </div>
  `;
}

function renderRouteProgramCards(list) {
  const cards = document.getElementById("route-course-grid");
  if (!cards) return;
  cards.innerHTML = list.length ? list.map((course, index) => `
    <article class="course-card tile-tone-${index % 3}" tabindex="0" role="button" aria-label="Open ${escapeHTML(course.title)} class" data-route-course="${escapeHTML(course.id)}">
      <div class="course-image">
        <img src="${escapeHTML(course.image || imageFallback)}" alt="" loading="lazy" />
        <span class="course-level">${escapeHTML(course.level)}</span>
        <span class="course-arrow" aria-hidden="true">↗</span>
      </div>
      <div class="course-meta"><span>${escapeHTML(course.category || "Studio course")}</span><span>${escapeHTML(course.lesson_count || 0)} lessons</span></div>
      <h3>${escapeHTML(course.title)}</h3>
      <p class="course-subtitle">${escapeHTML(course.subtitle || "A guided architecture design course.")}</p>
      ${renderCoursePriceRow(course)}
    </article>
  `).join("") : `<p class="route-empty">No programs match these filters.</p>`;
  cards.querySelectorAll("[data-route-course]").forEach(card => {
    card.addEventListener("click", () => navigate(`/programs/${encodeURIComponent(card.dataset.routeCourse)}`));
    card.addEventListener("keydown", event => {
      if (event.target.closest("[data-card-enroll]")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate(`/programs/${encodeURIComponent(card.dataset.routeCourse)}`);
      }
    });
  });
  cards.querySelectorAll("[data-card-enroll]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openCourse(button.dataset.cardEnroll);
    });
  });
  const routeCountEl = document.getElementById("route-program-count");
  if (routeCountEl) {
    routeCountEl.innerHTML = `Showing <strong>${list.length}</strong> course${list.length === 1 ? "" : "s"} visible`;
  }
}

async function renderStudentDashboard(renderId) {
  if (!student) {
    routePage.innerHTML = `
      ${routeHeader("Your learning starts here", "STUDENT PORTAL", "Sign in to find your courses, continue lessons, and track your progress.")}
      <div class="route-panel dashboard-login">
        <h2>Welcome to your studio.</h2>
        <p>Already enrolled? Sign in to open your personal learning space.</p>
        <button class="route-primary" id="dashboard-sign-in" type="button">Sign in to continue <span>↗</span></button>
        <a class="route-secondary" href="/programs" data-route="/programs">Explore programs instead</a>
      </div>
    `;
    document.getElementById("dashboard-sign-in").addEventListener("click", () => document.getElementById("sign-in-open").click());
    return;
  }
  routePage.innerHTML = `
    ${routeHeader(`Welcome, ${student.name}`, "YOUR LEARNING", "Your enrolled courses and lesson progress, all in one place.")}
    <div class="student-summary"><span><strong>${enrolledCourseIds.length}</strong> enrolled course${enrolledCourseIds.length === 1 ? "" : "s"}</span><span>${escapeHTML(student.email)}</span></div>
    <div class="student-course-grid" id="student-course-grid"><p class="route-loading">Loading your learning progress…</p></div>
  `;
  const enrolledCourses = courses.filter(course => isEnrolled(course.id));
  const progressResults = await Promise.all(enrolledCourses.map(async course => {
    try {
      const progress = await api(`/api/courses/${encodeURIComponent(course.id)}/progress`);
      const completedCount = progress.completedLessonIds.length;
      const totalCount = Number(course.lesson_count || 0) || 1;
      const percent = Math.min(100, Math.round((completedCount / totalCount) * 100));
      courseProgressMap.set(course.id, {
        completedCount,
        totalCount,
        percent,
        completedLessonIds: progress.completedLessonIds
      });
      return { id: course.id, completed: completedCount, percent };
    } catch (error) {
      return { id: course.id, error };
    }
  }));
  if (renderId !== routeRenderId) return;
  const progressByCourse = new Map(progressResults.map(item => [item.id, item]));
  const list = document.getElementById("student-course-grid");
  list.innerHTML = enrolledCourses.length ? enrolledCourses.map(course => {
    const progress = progressByCourse.get(course.id);
    return `
      <article class="student-course-card">
        <img src="${escapeHTML(course.image || imageFallback)}" alt="" />
        <div class="student-course-copy">
          <span class="university-eyebrow">${escapeHTML(course.level)} · ${escapeHTML(course.category || "Studio course")}</span>
          <h2>${escapeHTML(course.title)}</h2>
          <p>${escapeHTML(course.subtitle || "Continue learning at your own pace.")}</p>
          ${progress?.error ? `<p class="progress-error">${escapeHTML(progress.error.message)}</p>` : renderCourseProgressBar(course)}
          <button class="route-primary" type="button" data-continue-course="${escapeHTML(course.id)}">Continue course <span>↗</span></button>
        </div>
      </article>
    `;
  }).join("") : `<div class="route-panel"><h2>Your studio is ready.</h2><p>You haven’t enrolled in a course yet. Browse the programs and choose a place to begin.</p><a class="route-primary" href="/programs" data-route="/programs">Explore programs <span>↗</span></a></div>`;
  animateCourseProgressBars(list);
  list.querySelectorAll("[data-continue-course]").forEach(button => {
    button.addEventListener("click", async () => {
      const { course } = await api(`/api/courses/${encodeURIComponent(button.dataset.continueCourse)}`);
      await openLessons(course);
    });
  });
}

function adminLessonFields() {
  return `
    <label>Lesson title<input name="title" maxlength="160" placeholder="e.g. Designing for shade" required /></label>
    <label>Lesson video · MP4, WebM, or MOV (max 100 MB)<input name="video" type="file" accept="video/mp4,video/webm,video/quicktime" required /></label>
    <label>Quiz question<input name="question" minlength="5" placeholder="What is the key design principle?" required /></label>
    <div class="admin-choice-grid">
      <label>Answer choice 1<input name="choice1" required /></label>
      <label>Answer choice 2<input name="choice2" required /></label>
      <label>Answer choice 3<input name="choice3" required /></label>
    </div>
    <label>Correct answer<select name="answer"><option value="0">Answer choice 1</option><option value="1">Answer choice 2</option><option value="2">Answer choice 3</option></select></label>
  `;
}

function renderAdminLogin() {
  routePage.innerHTML = `
    ${routeHeader("Welcome back, administrator.", "B RENDER ADMIN", "Sign in to access the project content dashboard.")}
    <div class="route-panel admin-login-panel">
      <h2>Admin sign in</h2>
      <p>Use the administrator password configured for the B Render Family Architecture Academy.</p>
      <form class="admin-form admin-login-form" id="admin-login-form">
        <label>Admin password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="route-primary" type="submit">Open dashboard <span>↗</span></button>
      </form>
    </div>
  `;
  document.getElementById("admin-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: new FormData(form).get("password") })
      });
      await renderRoute();
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  });
}

function bindAdminUploadForm(form, endpoint, successMessage) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api(endpoint, { method: "POST", body: new FormData(form) });
      const { courses: updatedCourses } = await api("/api/courses");
      courses = updatedCourses;
      renderCourses();
      renderHeroFeaturedCourse();
      await renderRoute();
      showToast(successMessage, "success");
    } catch (error) {
      button.disabled = false;
      showToast(error.message, "error");
    }
  });
}

function renderAdminPanel(adminCourses) {
  const lessonCount = adminCourses.reduce((total, course) => total + Number(course.lesson_count || 0), 0);
  routePage.innerHTML = `
    <div class="admin-dashboard-heading">
      <div>${routeHeader("Lecturer & admin studio", "B RENDER LECTURER DASHBOARD", "Publish courses, set each course's price and learning level, and upload lesson videos.")}</div>
      <button class="admin-sign-out" id="admin-sign-out" type="button">Sign out</button>
    </div>
    <div class="admin-stats">
      <div><strong>${adminCourses.length}</strong><span>Published courses</span></div>
      <div><strong>${lessonCount}</strong><span>Video lessons</span></div>
    </div>
    <datalist id="admin-level-options">
      <option value="Beginner"></option>
      <option value="Intermediate"></option>
      <option value="Advanced"></option>
      <option value="Foundation"></option>
      <option value="Masterclass"></option>
    </datalist>
    <section class="admin-dashboard-panel">
      <div class="admin-panel-heading"><span class="university-eyebrow">NEW PROGRAM</span><h2>Publish a course</h2><p>Set the course title, price (GHS), learning level, and upload its first lesson video. Once saved, students can enroll immediately.</p></div>
      <form class="admin-form admin-create-form" id="admin-create-course">
        <div class="admin-course-fields">
          <label>Course title<input name="courseTitle" maxlength="160" placeholder="e.g. Climate-responsive design" required /></label>
          <label>Course price (GHS)<input name="price" type="number" min="1" max="100000" step="0.01" value="180" placeholder="e.g. 180" required /></label>
          <label>Learning level<input name="level" list="admin-level-options" maxlength="40" placeholder="e.g. Beginner, Intermediate, Studio I" required /></label>
          <label>Category<input name="category" maxlength="80" placeholder="e.g. Materials and climate" required /></label>
          <label class="admin-field-wide">Course image URL <span>(optional)</span><input name="image" type="url" placeholder="https://…" /></label>
          <label class="admin-field-wide">Course description<input name="subtitle" maxlength="240" placeholder="What will students learn?" required /></label>
        </div>
        <div class="admin-lesson-fields">
          <div class="admin-panel-heading"><span class="university-eyebrow">FIRST LESSON</span><h3>Video and quiz</h3></div>
          ${adminLessonFields()}
        </div>
        <button class="route-primary" type="submit">Publish course <span>↗</span></button>
      </form>
    </section>
    <section class="admin-course-section">
      <div class="admin-panel-heading"><span class="university-eyebrow">YOUR CATALOG</span><h2>Published courses</h2><p>Update a course's price and level, upload additional video lessons, or remove a course that should no longer be available.</p></div>
      <div class="admin-course-list">
        ${adminCourses.length ? adminCourses.map(course => `
          <article class="admin-course-card">
            <img src="${escapeHTML(course.image || imageFallback)}" alt="" />
            <div class="admin-course-copy">
              <span class="university-eyebrow">${escapeHTML(course.level)} · ${escapeHTML(course.category || "Studio course")} · ${escapeHTML(formatCoursePrice(course.price_minor))}</span>
              <h3>${escapeHTML(course.title)}</h3>
              <p>${escapeHTML(course.subtitle || "A guided architecture design course.")}</p>
              <small>${Number(course.lesson_count || 0)} video lesson${Number(course.lesson_count || 0) === 1 ? "" : "s"}</small>
              <div class="admin-course-actions">
                <a class="admin-preview-course" href="/programs/${encodeURIComponent(course.id)}" data-route="/programs/${encodeURIComponent(course.id)}">View course <span aria-hidden="true">↗</span></a>
                <button class="admin-delete-course" type="button" data-delete-course="${escapeHTML(course.id)}" data-course-title="${escapeHTML(course.title)}">Remove course</button>
              </div>
              <details class="admin-add-lesson admin-edit-details">
                <summary>Set price &amp; level</summary>
                <form class="admin-form admin-edit-course" data-course-id="${escapeHTML(course.id)}">
                  <div class="admin-edit-course-grid">
                    <label>Course price (GHS)<input name="price" type="number" min="1" max="100000" step="0.01" value="${(Number(course.price_minor || 18000) / 100).toFixed(2)}" required /></label>
                    <label>Learning level<input name="level" list="admin-level-options" maxlength="40" value="${escapeHTML(course.level)}" required /></label>
                  </div>
                  <button class="route-primary" type="submit">Update price &amp; level <span>↗</span></button>
                </form>
              </details>
              <details class="admin-add-lesson">
                <summary>Add a video lesson</summary>
                <form class="admin-form admin-existing-lesson" data-course-id="${escapeHTML(course.id)}">
                  ${adminLessonFields()}
                  <button class="route-primary" type="submit">Save lesson <span>↗</span></button>
                </form>
              </details>
            </div>
          </article>
        `).join("") : `<p class="route-empty">No courses yet. Publish your first course above.</p>`}
      </div>
    </section>
  `;
  bindAdminUploadForm(document.getElementById("admin-create-course"), "/api/admin/courses", "Course published.");
  routePage.querySelectorAll(".admin-edit-course").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      const formData = new FormData(form);
      try {
        await api(`/api/admin/courses/${encodeURIComponent(form.dataset.courseId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            price: String(formData.get("price") || "").trim(),
            level: String(formData.get("level") || "").trim()
          })
        });
        const { courses: updatedCourses } = await api("/api/courses");
        courses = updatedCourses;
        renderCourses();
        renderHeroFeaturedCourse();
        await renderRoute();
        showToast("Course price and level updated.", "success");
      } catch (error) {
        button.disabled = false;
        showToast(error.message, "error");
      }
    });
  });
  routePage.querySelectorAll(".admin-existing-lesson").forEach(form => {
    bindAdminUploadForm(form, `/api/admin/courses/${encodeURIComponent(form.dataset.courseId)}/lessons`, "Lesson added.");
  });
  routePage.querySelectorAll("[data-delete-course]").forEach(button => {
    button.addEventListener("click", async () => {
      const courseTitle = button.dataset.courseTitle;
      if (!window.confirm(`Remove "${courseTitle}" from the academy? This also deletes its lessons, video files, enrollments, and student progress.`)) return;
      button.disabled = true;
      try {
        const result = await api(`/api/admin/courses/${encodeURIComponent(button.dataset.deleteCourse)}`, { method: "DELETE" });
        const { courses: updatedCourses } = await api("/api/courses");
        courses = updatedCourses;
        renderCourses();
        renderHeroFeaturedCourse();
        await renderRoute();
        showToast(result.cleanupWarnings?.length
          ? `Course removed. ${result.cleanupWarnings.join(" ")}`
          : "Course and its lesson videos removed.");
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    });
  });
  document.getElementById("admin-sign-out").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      navigate("/");
      showToast("You have signed out of the admin dashboard.");
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function renderAdminDashboard(renderId) {
  routePage.innerHTML = `<p class="route-loading">Loading your admin dashboard…</p>`;
  try {
    const { isAdmin } = await api("/api/admin/session");
    if (renderId !== routeRenderId) return;
    if (!isAdmin) {
      renderAdminLogin();
      return;
    }
    const { courses: adminCourses } = await api("/api/admin/courses");
    if (renderId !== routeRenderId) return;
    renderAdminPanel(adminCourses);
  } catch (error) {
    if (renderId !== routeRenderId) return;
    if (error.status === 401) {
      renderAdminLogin();
      return;
    }
    routePage.innerHTML = `
      ${routeHeader("Dashboard unavailable", "B RENDER ADMIN", "The dashboard could not load its course catalog.")}
      <div class="route-panel"><p>${escapeHTML(error.message)}</p><button class="route-primary" id="admin-retry" type="button">Try again <span>↗</span></button></div>
    `;
    document.getElementById("admin-retry").addEventListener("click", () => renderRoute());
  }
}

async function renderRoute() {
  const renderId = ++routeRenderId;
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const detailMatch = /^\/programs\/([a-zA-Z0-9_-]+)$/.exec(pathname);
  const isHome = pathname === "/";
  document.body.classList.toggle("route-page-active", !isHome);
  routePage.hidden = isHome;
  document.querySelectorAll(".university-nav [data-route]").forEach(link => {
    const path = link.dataset.route;
    const active = path === pathname || (path === "/programs" && (pathname === "/programs" || Boolean(detailMatch)));
    link.classList.toggle("active", active);
  });
  if (isHome) return;

  if (pathname === "/about") {
    document.title = "About the Academy — B Render Family Architecture Academy";
    routePage.innerHTML = `
      ${routeHeader("Architecture is a way of seeing.", "ABOUT THE ACADEMY", "A family-led place to learn architectural thinking, drawing, and design.")}
      <div class="route-feature-split">
        <img src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1100&q=85" alt="Architectural drawing and design work" />
        <div><span class="university-eyebrow">LEARN WITH THE B RENDER FAMILY</span><h2>Understand space.<br /><em>Design with purpose.</em></h2><p>The B Render family created this academy to share architecture knowledge in a practical, approachable way. Our lessons connect observation and drawing with the decisions that shape real spaces.</p><p>Start with the foundations, learn at your own pace, and develop your own design point of view through focused courses and studio exercises.</p><a class="route-primary" href="/programs" data-route="/programs">Explore architecture courses <span>↗</span></a></div>
      </div>
      <div class="route-values"><article><span>01</span><h3>Observe</h3><p>Read the site, notice the light, and understand how people use spaces.</p></article><article><span>02</span><h3>Draw</h3><p>Communicate spatial ideas through sketches, plans, and clear diagrams.</p></article><article><span>03</span><h3>Design</h3><p>Connect people, context, materials, and purpose in thoughtful proposals.</p></article></div>
    `;
    return;
  }

  if (pathname === "/programs") {
    document.title = "Architecture Courses — B Render Family Academy";
    const availableLevels = [...new Set(courses.map(course => String(course.level || "").trim()).filter(Boolean))];
    routePage.innerHTML = `
      ${routeHeader("Explore architecture courses.", "B RENDER FAMILY ACADEMY", "Practical lessons in architectural drawing, materials, space, and design.")}
      <div class="route-filter-row"><label>Search programs<input id="route-course-search" type="search" placeholder="Try drawing, materials, or studio" /></label><label>Learning level<select id="route-level-filter"><option value="all">All levels</option>${availableLevels.map(lvl => `<option value="${escapeHTML(lvl)}">${escapeHTML(lvl)}</option>`).join("")}</select></label><span id="route-program-count"></span></div>
      <div class="program-grid route-program-grid course-grid" id="route-course-grid"></div>
    `;
    const search = document.getElementById("route-course-search");
    const level = document.getElementById("route-level-filter");
    const requestedLevel = new URLSearchParams(window.location.search).get("level");
    if (requestedLevel && availableLevels.includes(requestedLevel)) level.value = requestedLevel;
    const filterPrograms = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = courses.filter(course =>
        (level.value === "all" || course.level === level.value) &&
        (!query || `${course.title} ${course.category} ${course.subtitle} ${course.level}`.toLowerCase().includes(query))
      );
      renderRouteProgramCards(filtered);
    };
    search.addEventListener("input", filterPrograms);
    level.addEventListener("change", filterPrograms);
    filterPrograms();
    return;
  }

  if (detailMatch) {
    document.title = "Architecture Course — B Render Family Academy";
    routePage.innerHTML = `<div class="route-loading">Loading this program…</div>`;
    try {
      const { course } = await api(`/api/courses/${encodeURIComponent(detailMatch[1])}`);
      if (renderId !== routeRenderId) return;
      document.title = `${course.title} — B Render Family Academy`;
      routePage.innerHTML = `
        <a class="route-back" href="/programs" data-route="/programs">← All courses</a>
        <div class="program-detail">
          <div class="detail-copy">
            <span class="university-eyebrow">${escapeHTML(course.level)} · ${escapeHTML(course.category || "Studio course")}</span>
            <h1>${escapeHTML(course.title)}</h1>
            <p class="detail-subtitle">${escapeHTML(course.subtitle || "A guided architecture design course.")}</p>
            <div class="detail-facts"><span>${escapeHTML(course.lesson_count || course.lessons.length)} focused lessons</span><span>${escapeHTML(course.duration || "Self-paced")}</span><span>Learn at your pace</span></div>
            <p>This course develops practical architecture skills through clear lessons, real-world questions, and a quiz at the end of each video. Explore the curriculum, then enroll when you’re ready to begin.</p>
            <button class="route-primary" id="detail-enroll" type="button">${isEnrolled(course.id) ? "Open your course" : `Enroll now · ${escapeHTML(formatCoursePrice(course.price_minor, "GHS", { decimals: false }))}`} <span>↗</span></button>
            <p class="detail-note">Secure checkout powered by Paystack · Supports MTN MoMo, Telecel Cash, and Visa.</p>
          </div>
          <div class="detail-image"><img src="${escapeHTML(course.image || imageFallback)}" alt="" /></div>
        </div>
        <section class="detail-curriculum"><span class="university-eyebrow">COURSE CURRICULUM</span><h2>What you’ll learn</h2><div class="detail-lesson-list">${course.lessons.map((lesson, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHTML(lesson.title)}</strong><small>${escapeHTML(lesson.duration || "Focused lesson")} · video and quiz</small></div>`).join("") || "<p>Lessons for this course are being prepared.</p>"}</div></section>
      `;
      document.getElementById("detail-enroll").addEventListener("click", () => openCourse(course.id));
    } catch (error) {
      if (renderId !== routeRenderId) return;
      routePage.innerHTML = `${routeHeader("Course not found", "B RENDER FAMILY ACADEMY", "This course may have moved or is no longer available.")}<a class="route-primary" href="/programs" data-route="/programs">Browse architecture courses <span>↗</span></a>`;
    }
    return;
  }

  if (pathname === "/news") {
    document.title = "Learning Approach — B Render Family Academy";
    routePage.innerHTML = `
      ${routeHeader("Learn the principles. Practice the process.", "OUR LEARNING APPROACH", "Build your understanding of architecture through focused lessons and practical exercises.")}
      <div class="route-news-grid">
        <article class="route-news-feature"><img src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1100&q=85" alt="Architectural drawing and design work" /><span class="university-eyebrow">LEARN BY OBSERVING</span><h2>Start by seeing the space around you.</h2><p>Learn to notice light, movement, proportion, and context before shaping a design response.</p><a href="/programs" data-route="/programs">Find a course to begin <span>↗</span></a></article>
        <article class="route-news-card"><span class="university-eyebrow">LEARN BY DRAWING</span><h2>Make your ideas clear.</h2><p>Practice architectural plans and sketches as tools for thinking and communication.</p><a href="/programs/drawing-basics" data-route="/programs/drawing-basics">Explore drawing courses <span>↗</span></a></article>
        <article class="route-news-card"><span class="university-eyebrow">LEARN BY DESIGNING</span><h2>Connect people, place, and purpose.</h2><p>Bring design decisions together in practical architecture exercises.</p><a href="/programs" data-route="/programs">Explore all courses <span>↗</span></a></article>
      </div>
    `;
    return;
  }

  if (pathname === "/student/dashboard") {
    document.title = "My Learning — B Render Family Academy";
    await renderStudentDashboard(renderId);
    return;
  }

  if (pathname === "/admin/dashboard") {
    document.title = "Admin Dashboard — B Render Family Academy";
    await renderAdminDashboard(renderId);
    return;
  }

  document.title = "Page Not Found — B Render Family Academy";
  routePage.innerHTML = `${routeHeader("We couldn’t find that page.", "404 · PAGE NOT FOUND", "The page may have moved. Browse our programs to find your next step.")}<a class="route-primary" href="/programs" data-route="/programs">Browse programs <span>↗</span></a>`;
}

function showEnrollmentRequired() {
  openModal(`
    <div class="academy-course-picker">
      <header class="academy-learning-topbar">
        <div class="academy-learning-brand"><img src="/assets/b-render-logo.png" alt="B Render" /><span>B-RENDER ACADEMY</span></div>
        <span class="academy-learning-label">STUDENT ACCESS</span>
      </header>
      <div class="academy-picker-heading">
        <span class="academy-learning-eyebrow">START LEARNING</span>
        <h2 id="modal-title">Choose your first course.</h2>
        <p>Explore a course below and click <strong>Enroll now</strong> to unlock its lessons.</p>
      </div>
      <div class="program-grid course-grid academy-course-picks">${courses.map((course, index) => `
        <article class="course-card tile-tone-${index % 3}" tabindex="0" role="button" aria-label="Choose ${escapeHTML(course.title)} class" data-enroll-course="${escapeHTML(course.id)}">
          <div class="course-image">
            <img src="${escapeHTML(course.image || imageFallback)}" alt="" loading="lazy" />
            <span class="course-arrow" aria-hidden="true">↗</span>
          </div>
          <div class="course-meta"><span>${escapeHTML(course.category || "Studio course")}</span><span>${escapeHTML(course.lesson_count || 0)} lessons</span></div>
          <h3>${escapeHTML(course.title)}</h3>
          ${renderCoursePriceRow(course)}
        </article>
      `).join("") || `<p class="academy-picker-empty">Courses are not available right now. Please try again shortly.</p>`}</div>
      <div class="academy-picker-footer">
        <span>Secured by Paystack · MTN MoMo, Telecel Cash &amp; Visa accepted.</span>
        <button class="academy-existing-login" id="existing-login" type="button">Already enrolled? Sign in</button>
      </div>
    </div>
  `, "academy");
  modalContent.querySelectorAll("[data-enroll-course]").forEach(card => {
    card.addEventListener("click", () => openCourse(card.dataset.enrollCourse));
    card.addEventListener("keydown", event => {
      if (event.target.closest("[data-card-enroll]")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourse(card.dataset.enrollCourse);
      }
    });
  });
  modalContent.querySelectorAll("[data-card-enroll]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openCourse(button.dataset.cardEnroll);
    });
  });
  document.getElementById("existing-login").addEventListener("click", () => {
    showSignIn("Sign in with the account you created after paying for a course.", { existing: true });
  });
}

async function openCourse(courseId) {
  activeCourseId = courseId;
  try {
    const { course } = await api(`/api/courses/${encodeURIComponent(courseId)}`);
    if (isEnrolled(course.id)) {
      if (!student) {
        showSignIn("Sign in to open your paid course.", { courseId });
        return;
      }
      await openLessons(course);
      return;
    }
    selectedPayment = selectedPayment || "MTN MoMo";
    openCheckout(course);
  } catch (error) {
    showToast(error.message);
  }
}

function showPaymentStatusModal({
  status = "success",
  title = "",
  message = "",
  courseId = null,
  courseTitle = "",
  reference = "",
  method = "",
  amountLabel = "GHS 180.00",
  ticket = "",
  email = ""
} = {}) {
  const isSuccess = status === "success";
  const resolvedTitle = title || (isSuccess ? "Payment Confirmed" : "Payment Failed");
  const resolvedCourse = courseTitle || (courseId ? courses.find(c => c.id === courseId)?.title : "") || "Architecture Course";
  const requiresAccountSetup = isSuccess && Boolean(ticket) && !student;

  const summaryRows = [
    `<div class="payment-status-row"><span>Status</span><strong class="${isSuccess ? "is-paid" : "is-failed"}">${isSuccess ? "Paid · Verified" : "Not Completed"}</strong></div>`,
    resolvedCourse ? `<div class="payment-status-row"><span>Course</span><strong>${escapeHTML(resolvedCourse)}</strong></div>` : "",
    amountLabel ? `<div class="payment-status-row"><span>Amount</span><strong>${escapeHTML(amountLabel)}</strong></div>` : "",
    method ? `<div class="payment-status-row"><span>Method</span><strong>${escapeHTML(method)}</strong></div>` : "",
    reference ? `<div class="payment-status-row"><span>Reference</span><strong>${escapeHTML(reference)}</strong></div>` : ""
  ].filter(Boolean).join("");

  const primaryLabel = isSuccess
    ? (requiresAccountSetup ? "Create Account / Sign In to Unlock ↗" : (courseId ? "Start Learning Now ↗" : "Go to My Learning ↗"))
    : (courseId ? "Try Payment Again ↗" : "Browse Courses ↗");
  const secondaryLabel = isSuccess && !requiresAccountSetup ? "Go to My Learning" : "Close";

  openModal(`
    <div class="payment-status-card">
      <div class="payment-status-icon" aria-hidden="true">${isSuccess ? "✓" : "!"}</div>
      <span class="payment-status-kicker">${isSuccess ? "PAYSTACK PAYMENT CONFIRMED" : "PAYSTACK PAYMENT STATUS"}</span>
      <h2 id="modal-title">${escapeHTML(resolvedTitle)}</h2>
      <p class="payment-status-message">${escapeHTML(message)}</p>
      <div class="payment-status-summary">${summaryRows}</div>
      <div class="payment-status-actions">
        <button class="payment-status-primary" id="payment-status-primary" type="button">${escapeHTML(primaryLabel)}</button>
        <button class="payment-status-secondary" id="payment-status-secondary" type="button">${escapeHTML(secondaryLabel)}</button>
      </div>
    </div>
  `, isSuccess ? "payment-success" : "payment-error");

  document.getElementById("payment-status-primary").addEventListener("click", async () => {
    if (isSuccess) {
      if (requiresAccountSetup) {
        showSignIn("Payment confirmed! Create your student account or sign in to unlock your course.", {
          ticket,
          courseId,
          email
        });
      } else if (courseId) {
        await openCourse(courseId);
      } else {
        closeModal();
        navigate("/student/dashboard");
      }
    } else if (courseId) {
      await openCourse(courseId);
    } else {
      closeModal();
      navigate("/programs");
    }
  });

  document.getElementById("payment-status-secondary").addEventListener("click", () => {
    closeModal();
    if (isSuccess && !requiresAccountSetup) {
      navigate("/student/dashboard");
    }
  });
}

async function completeVerifiedPayment(reference, fallbackCourseId = null, fallbackEmail = "", fallbackMethod = "") {
  const result = await api("/api/checkout/verify", {
    method: "POST",
    body: JSON.stringify({ reference })
  });
  const targetCourseId = result.courseId || fallbackCourseId;
  const courseObj = targetCourseId ? courses.find(c => c.id === targetCourseId) : null;
  const amountLabel = result.amountMinor
    ? formatCoursePrice(result.amountMinor, result.currency || "GHS")
    : formatCoursePrice(courseObj?.price_minor);
  const paymentMethod = result.method || fallbackMethod;

  if (result.enrolled) {
    pendingPaymentTicket = null;
    await refreshSession();
    renderCourses();
    if (window.location.pathname !== "/") await renderRoute();
    showToast("Payment confirmed. Your course is now unlocked.", "success", {
      title: "Paystack Payment Successful"
    });
    showPaymentStatusModal({
      status: "success",
      title: "Payment Confirmed",
      message: "Your Paystack payment was verified and your course is now unlocked for lifetime access.",
      courseId: targetCourseId,
      courseTitle: courseObj?.title,
      reference: result.reference || reference,
      method: paymentMethod,
      amountLabel
    });
  } else {
    pendingPaymentTicket = {
      ticket: result.ticket,
      courseId: targetCourseId,
      email: result.email || fallbackEmail
    };
    showToast("Payment confirmed! Create your student account or sign in to unlock access.", "success", {
      title: "Paystack Payment Successful"
    });
    showPaymentStatusModal({
      status: "success",
      title: "Payment Confirmed",
      message: "Your Paystack payment was verified. Create a student account or sign in to link this course to your profile.",
      courseId: targetCourseId,
      courseTitle: courseObj?.title,
      reference: result.reference || reference,
      method: paymentMethod,
      amountLabel,
      ticket: result.ticket,
      email: result.email || fallbackEmail
    });
  }
}

function openCheckout(course) {
  const defaultEmail = student?.email || "";
  const coursePriceLabel = formatCoursePrice(course.price_minor);
  const lessonCount = Number(course.lesson_count || course.lessons?.length || 0);
  const methods = [
    {
      id: "Visa",
      title: "Credit Card",
      subtitle: "Visa · Mastercard · Verve",
      badgeClass: "pf-badge-card",
      badgeHtml: `<span class="pf-mc-circles" aria-hidden="true"><i></i><i></i></span>`
    },
    {
      id: "MTN MoMo",
      title: "MTN MoMo",
      subtitle: "Instant mobile money prompt",
      badgeClass: "pf-badge-momo",
      badgeHtml: `<span>MTN</span>`
    },
    {
      id: "Telecel Cash",
      title: "Telecel Cash",
      subtitle: "Mobile wallet checkout",
      badgeClass: "pf-badge-telecel",
      badgeHtml: `<span>TC</span>`
    }
  ];
  if (!methods.some(m => m.id === selectedPayment)) selectedPayment = "MTN MoMo";

  openModal(`
    <div class="pf-shell">
      <header class="pf-topbar">
        <button class="pf-back-btn" id="pf-back-btn" type="button" aria-label="Close payment form">‹</button>
        <h2 id="modal-title" class="pf-heading">Payment Method</h2>
        <span class="pf-topbar-spacer" aria-hidden="true"></span>
      </header>

      <div class="pf-price-header">
        <div class="pf-course-mini">
          <img src="${escapeHTML(course.image || imageFallback)}" alt="" />
          <div>
            <strong>${escapeHTML(course.title)}</strong>
            <span>${lessonCount} focused lesson${lessonCount === 1 ? "" : "s"} · Lifetime access</span>
          </div>
        </div>
        <div class="pf-price-figures">
          <span class="pf-price-label">Course fee</span>
          <strong>${escapeHTML(coursePriceLabel)}</strong>
        </div>
      </div>

      <div class="pf-methods" role="radiogroup" aria-label="Payment method">
        ${methods.map(method => `
          <button class="pf-method-card${selectedPayment === method.id ? " is-selected" : ""}" type="button" data-payment="${escapeHTML(method.id)}" aria-pressed="${selectedPayment === method.id ? "true" : "false"}">
            <span class="pf-method-icon ${method.badgeClass}" aria-hidden="true">${method.badgeHtml}</span>
            <span class="pf-method-copy">
              <strong>${escapeHTML(method.title)}</strong>
              <small>${escapeHTML(method.subtitle)}</small>
            </span>
            <span class="pf-radio-dot" aria-hidden="true"></span>
          </button>
        `).join("")}
      </div>

      <div class="pf-gold-banner">
        <span class="pf-gold-tag" aria-hidden="true">✦</span>
        <span class="pf-gold-text">Paystack Express Checkout</span>
        <span class="pf-gold-pill" id="pf-selected-badge">${escapeHTML(selectedPayment)}</span>
      </div>

      <div class="pf-divider"><span>or confirm receipt details</span></div>

      <div class="pf-brand-logos" aria-hidden="true">
        <span class="pf-brand-visa">VISA</span>
        <span class="pf-brand-mc"><i class="mc-r"></i><i class="mc-y"></i></span>
        <span class="pf-brand-momo">MTN MoMo</span>
        <span class="pf-brand-telecel">Telecel</span>
      </div>

      <form class="pf-form" id="checkout-form">
        <div class="pf-gray-card">
          <div class="pf-gray-card-head">
            <span>RECEIPT &amp; ACCESS</span>
            <strong id="pf-channel-label">${escapeHTML(selectedPayment === "Visa" ? "CARD" : "MOBILE MONEY")}</strong>
          </div>
          <label class="pf-input-group">
            <span>Receipt &amp; account email</span>
            <input name="email" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeHTML(defaultEmail)}" ${student ? "readonly" : ""} required />
          </label>
          <div class="pf-input-grid">
            <div class="pf-readonly-box">
              <span>Channel</span>
              <strong id="pf-channel-value">${escapeHTML(selectedPayment)}</strong>
            </div>
            <div class="pf-readonly-box">
              <span>Access</span>
              <strong>Lifetime</strong>
            </div>
            <div class="pf-readonly-box">
              <span>Currency</span>
              <strong>GHS</strong>
            </div>
          </div>
          <p class="pf-gray-note" id="pf-channel-note">${selectedPayment === "Visa" ? "You will enter your card number & CVV securely inside Paystack." : "You will authorize the mobile money prompt safely via Paystack."}</p>
        </div>

        <div class="pf-breakdown">
          <div class="pf-breakdown-row"><span>Course Amount</span><strong>${escapeHTML(coursePriceLabel)}</strong></div>
          <div class="pf-breakdown-row"><span>Additional Cost</span><strong>GHS 0.00</strong></div>
          <div class="pf-breakdown-total"><span>Total</span><strong>${escapeHTML(coursePriceLabel)}</strong></div>
        </div>

        <button class="pf-continue-btn" id="paystack-pay" type="submit">
          <span class="pf-lock-icon" aria-hidden="true">🔒</span>
          <span>Continue · Pay ${escapeHTML(coursePriceLabel)}</span>
        </button>

        <div class="pf-security-footer">
          <span>Your payment is secured</span>
          <div class="pf-security-badges" aria-hidden="true">
            <span class="pf-sec-visa">VISA SECURE</span>
            <span class="pf-sec-mc">Mastercard ID Check</span>
            <span class="pf-sec-pci">PCI DSS · Paystack</span>
          </div>
        </div>
      </form>
    </div>
  `, "payment-form");

  document.getElementById("pf-back-btn")?.addEventListener("click", closeModal);

  modalContent.querySelectorAll(".pf-method-card").forEach(button => {
    button.addEventListener("click", () => {
      selectedPayment = button.dataset.payment;
      modalContent.querySelectorAll(".pf-method-card").forEach(option => {
        const active = option === button;
        option.classList.toggle("is-selected", active);
        option.setAttribute("aria-pressed", String(active));
      });
      const badgeEl = document.getElementById("pf-selected-badge");
      const channelLabelEl = document.getElementById("pf-channel-label");
      const channelValEl = document.getElementById("pf-channel-value");
      const channelNoteEl = document.getElementById("pf-channel-note");
      if (badgeEl) badgeEl.textContent = selectedPayment;
      if (channelLabelEl) channelLabelEl.textContent = selectedPayment === "Visa" ? "CARD" : "MOBILE MONEY";
      if (channelValEl) channelValEl.textContent = selectedPayment;
      if (channelNoteEl) {
        channelNoteEl.textContent = selectedPayment === "Visa"
          ? "You will enter your card number & CVV securely inside Paystack."
          : "You will authorize the mobile money prompt safely via Paystack.";
      }
    });
  });

  const form = document.getElementById("checkout-form");
  const defaultBtnHtml = `<span class="pf-lock-icon" aria-hidden="true">🔒</span><span>Continue · Pay ${escapeHTML(coursePriceLabel)}</span>`;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("paystack-pay");
    const email = String(new FormData(form).get("email") || "").trim();
    button.disabled = true;
    button.textContent = "Preparing secure checkout…";
    try {
      const init = await api("/api/checkout/initialize", {
        method: "POST",
        body: JSON.stringify({ courseId: course.id, method: selectedPayment, email })
      });
      if (typeof window.PaystackPop === "function" && init.accessCode) {
        const popup = new window.PaystackPop();
        popup.resumeTransaction(init.accessCode, {
          onSuccess: async transaction => {
            button.textContent = "Verifying payment…";
            const txRef = transaction?.reference || init.reference;
            try {
              await completeVerifiedPayment(txRef, course.id, email, selectedPayment);
            } catch (error) {
              button.disabled = false;
              button.innerHTML = defaultBtnHtml;
              showToast(error.message, "error", { title: "Payment Verification Failed" });
              showPaymentStatusModal({
                status: "error",
                title: "Payment Verification Failed",
                message: error.message,
                courseId: course.id,
                courseTitle: course.title,
                reference: txRef,
                method: selectedPayment,
                amountLabel: coursePriceLabel
              });
            }
          },
          onCancel: () => {
            button.disabled = false;
            button.innerHTML = defaultBtnHtml;
            showToast("Checkout was cancelled. You have not been charged.", "warning", {
              title: "Payment Cancelled"
            });
          },
          onError: error => {
            const errMessage = error?.message || "Paystack could not process your payment. Please try again.";
            button.disabled = false;
            button.innerHTML = defaultBtnHtml;
            showToast(errMessage, "error", { title: "Payment Failed" });
            showPaymentStatusModal({
              status: "error",
              title: "Payment Failed",
              message: errMessage,
              courseId: course.id,
              courseTitle: course.title,
              reference: init.reference,
              method: selectedPayment,
              amountLabel: coursePriceLabel
            });
          }
        });
      } else if (init.authorizationUrl) {
        window.location.assign(init.authorizationUrl);
      } else {
        throw new Error("Could not launch Paystack checkout. Please try again.");
      }
    } catch (error) {
      button.disabled = false;
      button.innerHTML = defaultBtnHtml;
      showToast(error.message, "error", { title: "Checkout Unavailable" });
    }
  });
}

function showSignIn(message = "Sign in to continue learning.", options = {}) {
  if (!student && !options.ticket && !options.existing && enrolledCourseIds.length === 0) {
    showEnrollmentRequired();
    return;
  }
  const hasTicket = Boolean(options.ticket);
  const courseId = options.courseId || "";
  const prefillEmail = options.email || "";
  openModal(`
    <div class="auth-card-head">
      <span class="auth-card-kicker">${hasTicket ? "PAYMENT VERIFIED" : "B RENDER"}</span>
      <h2 id="modal-title">${hasTicket ? "Create an account" : "Welcome back"}</h2>
    </div>
    <div class="auth-card-body">
      <p class="auth-message">${escapeHTML(message)}</p>
      <div class="auth-divider"><span>CONTINUE WITH EMAIL</span></div>
    <form class="modal-form" id="auth-form">
      ${hasTicket ? `<div class="auth-name-row" id="name-fields">
        <label class="form-field"><span class="sr-only">First name</span><input name="firstName" autocomplete="given-name" placeholder="First name" minlength="1" maxlength="50" required /></label>
        <label class="form-field"><span class="sr-only">Last name</span><input name="lastName" autocomplete="family-name" placeholder="Last name" minlength="1" maxlength="50" required /></label>
      </div>` : ""}
      <label class="form-field"><span class="sr-only">Email address</span><input name="email" type="email" autocomplete="email" placeholder="Email" value="${escapeHTML(prefillEmail)}" required /></label>
      <label class="form-field auth-password-field"><span class="sr-only">Password</span><input name="password" type="password" autocomplete="${hasTicket ? "new-password" : "current-password"}" placeholder="Password" minlength="${hasTicket ? 10 : 1}" required /><button class="password-toggle" id="password-toggle" type="button" aria-label="Show password" aria-pressed="false">◉</button></label>
      <button class="button button-dark auth-submit" id="auth-submit" type="submit">${hasTicket ? "Create account" : "Log in"}</button>
      ${hasTicket ? `<p class="auth-policy">By creating an account, you’ll link this paid course to your student profile for lifetime access.</p>` : `<p class="auth-policy">Sign-in is available to students with a course enrollment.</p>`}
    </form>
    <p class="auth-switch">${hasTicket
      ? `<span id="auth-switch-label">Have an account?</span> <button class="auth-switch-link" id="auth-toggle" type="button">${hasTicket ? "Log in here" : "Create account"}</button>`
      : `Not enrolled yet? <button class="auth-switch-link" id="show-courses" type="button">Choose a course</button>`}</p>
    </div>
  `, "auth");

  let mode = hasTicket ? "register" : "login";
  const form = document.getElementById("auth-form");
  const nameFields = document.getElementById("name-fields");
  const submit = document.getElementById("auth-submit");
  const setMode = nextMode => {
    mode = nextMode;
    if (nameFields) {
      nameFields.hidden = mode !== "register";
      nameFields.querySelectorAll("input").forEach(input => { input.required = mode === "register"; });
    }
    document.getElementById("modal-title").textContent = mode === "register" ? "Create an account" : "Welcome back";
    submit.textContent = mode === "register" ? "Create account" : "Log in";
    document.getElementById("auth-switch-label").textContent = mode === "register" ? "Have an account?" : "New to B Render Academy?";
    document.getElementById("auth-toggle").textContent = mode === "register" ? "Log in here" : "Create account";
    form.elements.password.autocomplete = mode === "register" ? "new-password" : "current-password";
    form.elements.password.minLength = mode === "register" ? 10 : 1;
  };
  document.getElementById("auth-toggle")?.addEventListener("click", () => {
    if (hasTicket) setMode(mode === "register" ? "login" : "register");
    else showEnrollmentRequired();
  });
  document.getElementById("password-toggle").addEventListener("click", event => {
    const input = form.elements.password;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    event.currentTarget.setAttribute("aria-pressed", String(reveal));
    event.currentTarget.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  });
  document.getElementById("show-courses")?.addEventListener("click", showEnrollmentRequired);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("auth-submit");
    button.disabled = true;
    const values = Object.fromEntries(new FormData(form));
    if (mode === "register") {
      values.name = `${values.firstName} ${values.lastName}`.trim();
      delete values.firstName;
      delete values.lastName;
    }
    try {
      const result = await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          ...values,
          ticket: hasTicket ? options.ticket : undefined
        })
      });
      student = result.user;
      enrolledCourseIds = result.enrolledCourseIds;
      pendingPaymentTicket = null;
      await refreshUserProgress();
      updateSignInButton();
      renderCourses();
      const resumeCourseId = result.addedCourseId || courseId;
      closeModal();
      showToast(
        result.paid ? "Payment verified. Your course is now unlocked." : `Welcome, ${student.name.split(/\s+/)[0]}.`,
        "success",
        result.paid ? { title: "Enrollment Unlocked" } : {}
      );
      if (resumeCourseId) await openCourse(resumeCourseId);
      else if (window.location.pathname === "/student/dashboard") await renderRoute();
    } catch (error) {
      button.disabled = false;
      if (error.code === "PAYMENT_REQUIRED") {
        showEnrollmentRequired();
      } else if (error.code === "ACCOUNT_EXISTS" && hasTicket) {
        setMode("login");
        showToast("That email already has an account. Sign in to attach the paid course.");
      } else {
        showToast(error.message);
      }
    }
  });
}

async function openLessons(course) {
  try {
    const [{ completedLessonIds }, { course: freshCourse }] = await Promise.all([
      api(`/api/courses/${encodeURIComponent(course.id)}/progress`),
      api(`/api/courses/${encodeURIComponent(course.id)}`)
    ]);
    course = freshCourse;
    const completed = new Set(completedLessonIds);
    openModal(`
      <div class="academy-outline">
        <div class="academy-learning-topbar">
          <div class="academy-learning-brand"><img src="/assets/b-render-logo.png" alt="B Render" /><span>B-RENDER ACADEMY</span></div>
          <span class="academy-learning-label">YOUR COURSE</span>
        </div>
        <span class="academy-learning-eyebrow">${escapeHTML(course.level)} · ${escapeHTML(course.category || "STUDIO COURSE")}</span>
        <h2 id="modal-title">${escapeHTML(course.title)}</h2>
        <p>${escapeHTML(course.subtitle || "Continue learning at your own pace.")}</p>
        <div class="academy-outline-progress"><span>${completed.size} OF ${course.lessons.length} LESSONS COMPLETE</span><div><i style="width:${course.lessons.length ? Math.min(100, completed.size / course.lessons.length * 100) : 0}%"></i></div></div>
        <div class="lesson-list">${course.lessons.map((lesson, index) => `
        <div class="lesson-row">
          <span class="lesson-play">${completed.has(lesson.id) ? "✓" : "▶"}</span>
          <div><strong>${escapeHTML(lesson.title)}</strong><small>Video · ${escapeHTML(lesson.duration || "10 min")} · quiz included</small></div>
          <button data-lesson="${index}">${completed.has(lesson.id) ? "Review" : "Watch"}</button>
        </div>
      `).join("") || `<p>No lessons have been added to this course yet.</p>`}</div>
        <p class="academy-learning-note">Lessons unlock in order. Complete each quiz to continue.</p>
      </div>
    `, "academy");
    modalContent.querySelectorAll("[data-lesson]").forEach(button => button.addEventListener("click", () => {
      const index = Number(button.dataset.lesson);
      const firstIncomplete = course.lessons.findIndex(lesson => !completed.has(lesson.id));
      if (firstIncomplete !== -1 && index > firstIncomplete) {
        showToast("Finish the previous lesson quiz to unlock this one.");
        return;
      }
      openLessonPlayer(course, index, completed);
    }));
  } catch (error) {
    showToast(error.message);
  }
}

async function openLessonPlayer(course, index, completed = new Set()) {
  const summary = course.lessons[index];
  if (!summary) return;
  try {
    const { lesson } = await api(`/api/lessons/${encodeURIComponent(summary.id)}`);
    const firstIncomplete = course.lessons.findIndex(item => !completed.has(item.id));
    openModal(`
      <div class="academy-player">
        <header class="academy-player-header">
          <button class="academy-player-back" id="player-back" type="button">← COURSE OUTLINE</button>
          <span class="academy-player-brand"><img src="/assets/b-render-logo.png" alt="B Render" /><span>LEARNING STUDIO</span></span>
          <span class="academy-player-lesson-number">${String(index + 1).padStart(2, "0")} / ${String(course.lessons.length).padStart(2, "0")}</span>
        </header>
        <div class="academy-player-layout">
          <section class="academy-player-main">
            <div class="academy-video-frame">${lesson.videoUrl
              ? `<video controls playsinline src="${escapeHTML(lesson.videoUrl)}"></video>`
              : `<div class="academy-video-placeholder"><span>▶</span><strong>Lesson video coming soon</strong><small>This lesson is ready for its video upload.</small></div>`}</div>
            <div class="academy-player-title">
              <span class="academy-learning-eyebrow">${escapeHTML(course.category || "ARCHITECTURE")} · LESSON ${String(index + 1).padStart(2, "0")}</span>
              <h2 id="modal-title">${escapeHTML(lesson.title)}</h2>
              <p>${escapeHTML(course.title)} <span>·</span> ${escapeHTML(lesson.duration || "Self-paced")}</p>
            </div>
            <form id="quiz-form" class="academy-quiz">
              <div class="academy-quiz-heading"><span>QUICK CHECK</span><strong>${escapeHTML(lesson.quiz)}</strong></div>
              <div class="academy-quiz-options">${lesson.choices.map((choice, choiceIndex) => `
                <label class="quiz-option"><input type="radio" name="answer" value="${choiceIndex}" required /><span>${escapeHTML(choice)}</span></label>
              `).join("")}</div>
              <button class="academy-quiz-submit" type="submit">Check my answer <span aria-hidden="true">↗</span></button>
              <div id="quiz-result" aria-live="polite"></div>
            </form>
          </section>
          <aside class="academy-playlist">
            <span class="academy-learning-eyebrow">YOUR COURSE</span>
            <h3>${escapeHTML(course.title)}</h3>
            <div class="academy-playlist-progress"><span>${completed.size} OF ${course.lessons.length} LESSONS COMPLETE</span><div><i style="width:${course.lessons.length ? Math.min(100, completed.size / course.lessons.length * 100) : 0}%"></i></div></div>
            <div class="academy-playlist-items">${course.lessons.map((item, lessonIndex) => {
              const isComplete = completed.has(item.id);
              const isLocked = firstIncomplete !== -1 && lessonIndex > firstIncomplete;
              return `<button class="academy-playlist-item${lessonIndex === index ? " is-current" : ""}${isComplete ? " is-complete" : ""}" type="button" data-player-lesson="${lessonIndex}"${isLocked ? " disabled" : ""}>
                <span class="academy-playlist-icon">${isComplete ? "✓" : isLocked ? "×" : "▶"}</span>
                <span class="academy-playlist-copy"><small>LESSON ${String(lessonIndex + 1).padStart(2, "0")}</small><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.duration || "Focused lesson")}</small></span>
                <span class="academy-playlist-state">${isComplete ? "DONE" : isLocked ? "LOCKED" : lessonIndex === index ? "NOW" : "PLAY"}</span>
              </button>`;
            }).join("") || `<p class="academy-learning-note">This course has no lessons yet.</p>`}</div>
          </aside>
        </div>
      </div>
    `, "academy");
    document.getElementById("player-back").addEventListener("click", () => openLessons(course));
    modalContent.querySelectorAll("[data-player-lesson]").forEach(button => button.addEventListener("click", () => {
      const lessonIndex = Number(button.dataset.playerLesson);
      const nextIncomplete = course.lessons.findIndex(item => !completed.has(item.id));
      if (nextIncomplete !== -1 && lessonIndex > nextIncomplete) {
        showToast("Finish the previous lesson quiz to unlock this one.");
        return;
      }
      openLessonPlayer(course, lessonIndex, completed);
    }));
    document.getElementById("quiz-form").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button[type=submit]");
      button.disabled = true;
      const answer = Number(new FormData(event.currentTarget).get("answer"));
      const result = document.getElementById("quiz-result");
      try {
        const quizResult = await api(`/api/lessons/${encodeURIComponent(lesson.id)}/quiz`, {
          method: "POST",
          body: JSON.stringify({ answer })
        });
        result.className = "quiz-result";
        result.textContent = quizResult.correct
          ? "Correct. Your progress is saved to your account."
          : "Not quite. Revisit the lesson and try again.";
        button.disabled = false;
        if (quizResult.correct) {
          completed.add(lesson.id);
          await refreshUserProgress();
          renderCourses();
          button.textContent = index + 1 < course.lessons.length ? "Continue to next lesson →" : "Back to course";
          button.addEventListener("click", clickEvent => {
            clickEvent.preventDefault();
            if (index + 1 < course.lessons.length) openLessonPlayer(course, index + 1, completed);
            else openLessons(course);
          }, { once: true });
        }
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    });
  } catch (error) {
    showToast(error.message);
  }
}

function openAdmin() {
  navigate("/admin/dashboard");
}

async function refreshSession() {
  const result = await api("/api/me");
  student = result.user;
  enrolledCourseIds = result.enrolledCourseIds;
  if (courses && courses.length) {
    await refreshUserProgress();
  }
  updateSignInButton();
}

document.getElementById("course-search").addEventListener("input", () => {
  renderCourses();
});

document.getElementById("sign-in-open").addEventListener("click", async () => {
  if (student) {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      student = null;
      enrolledCourseIds = [];
      courseProgressMap.clear();
      updateSignInButton();
      renderCourses();
      if (window.location.pathname === "/student/dashboard") await renderRoute();
      showToast("You have signed out.");
    } catch (error) {
      showToast(error.message);
    }
  } else if (pendingPaymentTicket) {
    showSignIn("Payment confirmed! Create your student account or sign in to unlock your course.", pendingPaymentTicket);
  } else if (enrolledCourseIds.length) {
    showSignIn();
  } else {
    showEnrollmentRequired();
  }
});
document.getElementById("join-open").addEventListener("click", () => navigate("/programs"));
document.getElementById("admin-open").addEventListener("click", openAdmin);
document.getElementById("footer-teach").addEventListener("click", openAdmin);
document.getElementById("live-lessons-open").addEventListener("click", () => showToast("Live lessons will be available soon."));
function openProfileModal() {
  if (!student) {
    document.getElementById("sign-in-open").click();
    return;
  }
  openModal(`
    <span class="modal-kicker">Your learning profile</span>
    <h2 id="modal-title">${escapeHTML(student.name)}</h2>
    <p>${escapeHTML(student.email)}</p>
    <div class="pricing-box"><div><strong>${enrolledCourseIds.length}</strong><br /><span>course${enrolledCourseIds.length === 1 ? "" : "s"} in your library</span></div><span>B Render Academy learner</span></div>
    <button class="button button-dark" id="profile-sign-out" type="button" style="width:100%">Sign out</button>
  `);
  document.getElementById("profile-sign-out").addEventListener("click", () => {
    closeModal();
    document.getElementById("sign-in-open").click();
  });
}
document.getElementById("profile-open")?.addEventListener("click", openProfileModal);
document.getElementById("hero-profile-open")?.addEventListener("click", openProfileModal);
document.getElementById("modal-close").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", event => { if (event.target === modalBackdrop) closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !modalBackdrop.hidden) closeModal(); });
document.getElementById("calendar-prev").addEventListener("click", () => {
  displayedCalendar.setMonth(displayedCalendar.getMonth() - 1);
  renderCalendar();
});
document.getElementById("calendar-next").addEventListener("click", () => {
  displayedCalendar.setMonth(displayedCalendar.getMonth() + 1);
  renderCalendar();
});
document.getElementById("today-label").textContent = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});
renderCalendar();
const appSidebar = document.getElementById("app-sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const menuToggleBtn = document.getElementById("menu-toggle");
const sidebarCloseBtn = document.getElementById("sidebar-close");

function setSidebarOpen(isOpen) {
  if (!appSidebar) return;
  appSidebar.classList.toggle("sidebar-open", Boolean(isOpen));
  if (sidebarBackdrop) sidebarBackdrop.hidden = !isOpen;
  if (menuToggleBtn) menuToggleBtn.setAttribute("aria-expanded", String(Boolean(isOpen)));
}

menuToggleBtn?.addEventListener("click", () => {
  const next = !(appSidebar && appSidebar.classList.contains("sidebar-open"));
  setSidebarOpen(next);
});
sidebarCloseBtn?.addEventListener("click", () => setSidebarOpen(false));
sidebarBackdrop?.addEventListener("click", () => setSidebarOpen(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && appSidebar?.classList.contains("sidebar-open")) {
    setSidebarOpen(false);
  }
});
document.getElementById("sign-in-open")?.addEventListener("click", () => setSidebarOpen(false));
document.addEventListener("click", event => {
  const link = event.target.closest("a[data-route]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(link.dataset.route);
  setSidebarOpen(false);
});
document.querySelectorAll(".sidebar-link[href]").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".sidebar-link").forEach(item => item.classList.toggle("active", item === link));
  setSidebarOpen(false);
}));
document.querySelectorAll(".hero-rail-link[data-route]").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".hero-rail-link[data-route]").forEach(item => item.classList.toggle("active", item === link));
}));
window.addEventListener("popstate", renderRoute);

async function initialize() {
  try {
    const [courseResult, sessionResult] = await Promise.all([api("/api/courses"), api("/api/me")]);
    courses = courseResult.courses;
    student = sessionResult.user;
    enrolledCourseIds = sessionResult.enrolledCourseIds;
    await refreshUserProgress();
    updateSignInButton();
    renderCourses();
    renderHeroFeaturedCourse();
    await renderRoute();

    const params = new URLSearchParams(window.location.search);
    const paystackRef = params.get("reference") || params.get("trxref");
    const paymentStatus = params.get("payment");
    const paymentError = params.get("payment_error");
    if (paystackRef || paymentStatus || paymentError) {
      params.delete("reference");
      params.delete("trxref");
      params.delete("payment");
      params.delete("payment_error");
      const cleanQuery = params.toString();
      history.replaceState({}, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`);
      const detailMatch = /^\/programs\/([a-zA-Z0-9_-]+)$/.exec(window.location.pathname);
      const routeCourseId = detailMatch ? detailMatch[1] : null;
      const routeCourse = routeCourseId ? courses.find(c => c.id === routeCourseId) : null;
      const routePriceLabel = formatCoursePrice(routeCourse?.price_minor);
      if (paymentError) {
        showToast(paymentError, "error", { title: "Payment Failed" });
        showPaymentStatusModal({
          status: "error",
          title: "Payment Failed",
          message: paymentError,
          courseId: routeCourseId,
          courseTitle: routeCourse?.title,
          reference: paystackRef || "",
          amountLabel: routePriceLabel
        });
      } else if (paymentStatus === "success" && (!student || (routeCourseId && !isEnrolled(routeCourseId))) && paystackRef) {
        showToast("Finalizing your course enrollment…", "info", { title: "Verifying Payment" });
        try {
          await completeVerifiedPayment(paystackRef, routeCourseId);
        } catch (verifyError) {
          showToast(verifyError.message, "error", { title: "Payment Verification Failed" });
          showPaymentStatusModal({
            status: "error",
            title: "Payment Verification Failed",
            message: verifyError.message,
            courseId: routeCourseId,
            courseTitle: routeCourse?.title,
            reference: paystackRef,
            amountLabel: routePriceLabel
          });
        }
      } else if (paymentStatus === "success") {
        showToast("Payment confirmed. Your course is now unlocked.", "success", {
          title: "Paystack Payment Successful"
        });
        showPaymentStatusModal({
          status: "success",
          title: "Payment Confirmed",
          message: "Your Paystack payment was verified and your course is now unlocked for lifetime access.",
          courseId: routeCourseId,
          courseTitle: routeCourse?.title,
          reference: paystackRef || "",
          amountLabel: routePriceLabel
        });
      } else if (paystackRef) {
        showToast("Verifying your Paystack payment…", "info", { title: "Verifying Payment" });
        try {
          await completeVerifiedPayment(paystackRef, routeCourseId);
        } catch (verifyError) {
          showToast(verifyError.message, "error", { title: "Payment Verification Failed" });
          showPaymentStatusModal({
            status: "error",
            title: "Payment Verification Failed",
            message: verifyError.message,
            courseId: routeCourseId,
            courseTitle: routeCourse?.title,
            reference: paystackRef,
            amountLabel: routePriceLabel
          });
        }
      }
    }
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">The B Render Academy server is unavailable. Start it with <code>npm start</code>, then refresh this page.</div>`;
    showToast(error.message);
  }
}

initialize();

function setup3DTiltInteractions() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tiltSelector = [
    ".course-card",
    ".academy-hero-feature",
    ".academy-featured-course",
    ".academy-family-card",
    ".academy-method-grid article",
    ".academy-contact .br-contact-card",
    ".route-values article",
    ".route-news-feature",
    ".route-news-card",
    ".student-course-card",
    ".admin-course-card",
    ".academy-course-pick"
  ].join(",");

  let activeCard = null;
  let releaseTimer = null;

  const resetCard = (card, keepTouchDelay = false) => {
    if (!card) return;
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--px", "0px");
    card.style.setProperty("--py", "0px");
    card.style.setProperty("--mx", "50%");
    card.style.setProperty("--my", "50%");
    if (keepTouchDelay) {
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => {
        card.classList.remove("is-touched");
      }, 220);
    } else {
      card.classList.remove("is-touched");
    }
  };

  const updateCardTilt = (card, clientX, clientY, isTouch) => {
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    const rotateY = (clampedX - 0.5) * 16;
    const rotateX = (0.5 - clampedY) * 16;
    const shiftX = (clampedX - 0.5) * 14;
    const shiftY = (clampedY - 0.5) * 14;
    card.style.setProperty("--rx", `${rotateX.toFixed(2)}deg`);
    card.style.setProperty("--ry", `${rotateY.toFixed(2)}deg`);
    card.style.setProperty("--px", `${shiftX.toFixed(1)}px`);
    card.style.setProperty("--py", `${shiftY.toFixed(1)}px`);
    card.style.setProperty("--mx", `${(clampedX * 100).toFixed(1)}%`);
    card.style.setProperty("--my", `${(clampedY * 100).toFixed(1)}%`);
    if (isTouch) {
      window.clearTimeout(releaseTimer);
      card.classList.add("is-touched");
    }
  };

  document.addEventListener("pointerdown", event => {
    const isTouch = event.pointerType !== "mouse";
    const card = event.target.closest ? event.target.closest(tiltSelector) : null;
    if (activeCard && activeCard !== card) {
      resetCard(activeCard);
    }
    activeCard = card;
    if (card) {
      updateCardTilt(card, event.clientX, event.clientY, isTouch);
    }
  }, { passive: true });

  document.addEventListener("pointermove", event => {
    const isTouch = event.pointerType !== "mouse";
    const card = event.target.closest ? event.target.closest(tiltSelector) : null;
    if (activeCard && activeCard !== card) {
      resetCard(activeCard);
    }
    activeCard = card;
    if (!card) return;
    updateCardTilt(card, event.clientX, event.clientY, isTouch);
  }, { passive: true });

  const handleRelease = keepDelay => {
    if (!activeCard) return;
    const cardToReset = activeCard;
    activeCard = null;
    resetCard(cardToReset, keepDelay);
  };

  document.addEventListener("pointerup", event => {
    handleRelease(event.pointerType !== "mouse");
  }, { passive: true });

  document.addEventListener("pointercancel", () => {
    handleRelease(false);
  }, { passive: true });

  document.addEventListener("pointerleave", () => {
    handleRelease(false);
  }, { passive: true });

  const hero = document.querySelector(".academy-hero");
  const updateHeroPointer = (clientX, clientY) => {
    if (!hero) return;
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = Math.max(-0.5, Math.min(0.5, (clientX - rect.left) / rect.width - 0.5));
    const ny = Math.max(-0.5, Math.min(0.5, (clientY - rect.top) / rect.height - 0.5));
    hero.style.setProperty("--hero-px", `${(nx * 36).toFixed(1)}px`);
    hero.style.setProperty("--hero-py", `${(ny * 28).toFixed(1)}px`);
  };

  if (hero) {
    hero.addEventListener("pointerdown", event => {
      updateHeroPointer(event.clientX, event.clientY);
    }, { passive: true });
    hero.addEventListener("pointermove", event => {
      updateHeroPointer(event.clientX, event.clientY);
    }, { passive: true });
    const resetHeroPointer = () => {
      hero.style.setProperty("--hero-px", "0px");
      hero.style.setProperty("--hero-py", "0px");
    };
    hero.addEventListener("pointerup", resetHeroPointer, { passive: true });
    hero.addEventListener("pointercancel", resetHeroPointer, { passive: true });
    hero.addEventListener("pointerleave", resetHeroPointer, { passive: true });
  }

  // Scroll-driven spatial depth (works automatically on mobile & desktop without touch/hover)
  let scrollFramePending = false;
  const updateScrollSpatialDepth = () => {
    scrollFramePending = false;
    const vh = window.innerHeight || 800;
    const sy = Math.max(0, window.scrollY || 0);
    if (hero) {
      hero.style.setProperty("--hero-scroll-y", `${Math.min(180, sy).toFixed(1)}px`);
    }
    const cards = document.querySelectorAll(tiltSelector);
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.bottom < -120 || rect.top > vh + 120) return;
      const centerRatio = (rect.top + rect.height * 0.5 - vh * 0.5) / vh;
      const clamped = Math.max(-0.75, Math.min(0.75, centerRatio));
      const pitch = -clamped * 6.5;
      const yaw = (index % 2 === 0 ? 1 : -1) * clamped * 2.8;
      card.style.setProperty("--scroll-rx", `${pitch.toFixed(2)}deg`);
      card.style.setProperty("--scroll-ry", `${yaw.toFixed(2)}deg`);
    });
  };

  window.addEventListener("scroll", () => {
    if (scrollFramePending) return;
    scrollFramePending = true;
    requestAnimationFrame(updateScrollSpatialDepth);
  }, { passive: true });
  requestAnimationFrame(updateScrollSpatialDepth);

  // Phone gyroscope / device tilt parallax (no permission prompt, works passively when supported)
  if ("DeviceOrientationEvent" in window) {
    let gyroFramePending = false;
    let targetGx = 0;
    let targetGy = 0;

    const applyGyroParallax = () => {
      gyroFramePending = false;
      if (hero) {
        hero.style.setProperty("--hero-gx", `${(targetGx * 2.2).toFixed(1)}px`);
        hero.style.setProperty("--hero-gy", `${(targetGy * 1.8).toFixed(1)}px`);
      }
      const vh = window.innerHeight || 800;
      const rx = `${(-targetGy * 0.85).toFixed(2)}deg`;
      const ry = `${(targetGx * 0.95).toFixed(2)}deg`;
      document.querySelectorAll(tiltSelector).forEach(card => {
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > vh) return;
        card.style.setProperty("--gyro-rx", rx);
        card.style.setProperty("--gyro-ry", ry);
      });
    };

    window.addEventListener("deviceorientation", event => {
      if (typeof event.gamma !== "number" || typeof event.beta !== "number") return;
      targetGx = Math.max(-10, Math.min(10, event.gamma * 0.35));
      targetGy = Math.max(-8, Math.min(8, (event.beta - 42) * 0.25));
      if (gyroFramePending) return;
      gyroFramePending = true;
      requestAnimationFrame(applyGyroParallax);
    }, { passive: true });
  }
}

function setupSpatialScrollReveal() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const revealSelector = [
    ".academy-welcome-copy",
    ".academy-family-card",
    ".academy-method-heading",
    ".academy-method-grid article",
    ".academy-contact > div",
    ".academy-contact .br-contact-card",
    ".program-heading",
    ".program-controls",
    ".route-heading",
    ".route-feature-split",
    ".route-values article",
    ".route-news-feature",
    ".route-news-card",
    ".program-detail",
    ".detail-curriculum",
    ".student-summary",
    ".student-course-card",
    ".admin-stats",
    ".admin-dashboard-panel",
    ".admin-course-card"
  ].join(",");

  const observer = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" })
    : null;

  const revealVisibleElements = root => {
    const scope = root && root.querySelectorAll ? root : document;
    const targets = scope.querySelectorAll(revealSelector);
    targets.forEach((el, index) => {
      if (el.dataset.spatialObserved === "1") return;
      el.dataset.spatialObserved = "1";
      el.style.setProperty("--reveal-delay", `${Math.min((index % 6) * 75, 375)}ms`);
      el.classList.add("spatial-reveal");
      const rect = el.getBoundingClientRect();
      const inViewport = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 0.96 && rect.bottom > 0;
      if (!observer || inViewport) {
        requestAnimationFrame(() => el.classList.add("is-revealed"));
      } else {
        observer.observe(el);
      }
    });
  };

  revealVisibleElements(document);

  let rafPending = false;
  const scheduleReveal = target => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      revealVisibleElements(target || document);
    });
  };

  if (routePage && typeof MutationObserver === "function") {
    new MutationObserver(() => scheduleReveal(routePage)).observe(routePage, {
      childList: true,
      subtree: true
    });
  }

  window.addEventListener("scroll", () => {
    document.querySelectorAll(".spatial-reveal:not(.is-revealed)").forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 0.98) {
        el.classList.add("is-revealed");
        if (observer) observer.unobserve(el);
      }
    });
  }, { passive: true });
}

setup3DTiltInteractions();
setupSpatialScrollReveal();

