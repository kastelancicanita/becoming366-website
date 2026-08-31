document.addEventListener("DOMContentLoaded", () => {

  const toggle = document.querySelector(".menu-toggle");

  const mobileNav = document.querySelector(".nav-mobile");



  function setMenuOpen(isOpen) {

    if (!toggle || !mobileNav) return;

    mobileNav.classList.toggle("open", isOpen);

    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

    toggle.setAttribute(

      "aria-label",

      isOpen ? "Close menu" : "Open menu"

    );

  }



  if (toggle && mobileNav) {

    toggle.setAttribute("aria-expanded", "false");



    toggle.addEventListener("click", () => {

      setMenuOpen(!mobileNav.classList.contains("open"));

    });



    mobileNav.querySelectorAll("a").forEach((link) => {

      link.addEventListener("click", () => {

        setMenuOpen(false);

      });

    });



    document.addEventListener("click", (event) => {

      if (!mobileNav.classList.contains("open")) return;

      const target = event.target;

      if (

        target instanceof Node &&

        !mobileNav.contains(target) &&

        !toggle.contains(target)

      ) {

        setMenuOpen(false);

      }

    });



    document.addEventListener("keydown", (event) => {

      if (event.key === "Escape") {

        setMenuOpen(false);

      }

    });

  }



  initCarousels();

  initJournalFilter();

  initJournalReadTracking();

  initNewsletterForm();

});



const MAILERLITE_FORM_URL =
  "https://assets.mailerlite.com/jsonp/2606766/forms/197318874706740920/subscribe";

const MAILERLITE_JSONP_CALLBACK = "mlWebformSubmitted";

function getMailerLiteGuid() {
  try {
    if (window.localStorage?.ml_guid) {
      return window.localStorage.ml_guid;
    }

    const guid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ml-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    window.localStorage.ml_guid = guid;
    return guid;
  } catch {
    return "";
  }
}

function buildMailerLiteParams(form) {
  const params = new URLSearchParams();
  const formData = new FormData(form);

  formData.forEach((value, key) => {
    params.append(key, String(value));
  });

  params.set("ajax", "1");

  const guid = getMailerLiteGuid();
  if (guid) {
    params.set("guid", guid);
  }

  return params;
}

function submitViaJsonp(form) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const params = buildMailerLiteParams(form);
    params.set("callback", MAILERLITE_JSONP_CALLBACK);

    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.remove();

      if (window[MAILERLITE_JSONP_CALLBACK] === handler) {
        delete window[MAILERLITE_JSONP_CALLBACK];
      }
    };

    const handler = (response) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (response?.success) {
        resolve(response);
        return;
      }

      reject(response || new Error("Subscribe failed"));
    };

    const previousHandler = window[MAILERLITE_JSONP_CALLBACK];
    window[MAILERLITE_JSONP_CALLBACK] = (response) => {
      handler(response);

      if (
        typeof previousHandler === "function" &&
        previousHandler !== handler
      ) {
        previousHandler(response);
      }
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Network error"));
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timeout"));
    }, 15000);

    script.src = `${MAILERLITE_FORM_URL}?${params.toString()}`;
    document.body.appendChild(script);
  });
}

async function submitViaPost(form) {
  const body = buildMailerLiteParams(form);

  const response = await fetch(MAILERLITE_FORM_URL, {
    method: "POST",
    body,
    mode: "cors",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data?.success) {
    throw data || new Error("Subscribe failed");
  }

  return data;
}

async function submitViaNoCorsPost(form) {
  const body = buildMailerLiteParams(form);

  await fetch(MAILERLITE_FORM_URL, {
    method: "POST",
    body,
    mode: "no-cors",
    credentials: "omit",
  });

  return { success: true };
}

async function submitToMailerLite(form) {
  try {
    return await submitViaJsonp(form);
  } catch {
    try {
      return await submitViaPost(form);
    } catch {
      return submitViaNoCorsPost(form);
    }
  }
}

function showLetterFormSuccess() {
  const formPanel = document.getElementById("letter-form-panel");
  const successPanel = document.getElementById("letter-form-success");
  const errorMessage = document.getElementById("letter-form-error");

  if (errorMessage) errorMessage.hidden = true;
  if (formPanel) formPanel.hidden = true;
  if (successPanel) successPanel.hidden = false;
}

function initNewsletterForm() {
  const form = document.getElementById("becoming-letter-form");
  if (!form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const emailInput = form.querySelector('input[name="fields[email]"]');
  const errorMessage = document.getElementById("letter-form-error");
  const defaultButtonText = submitButton?.textContent?.trim() || "Join the Letter →";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput?.value.trim();
    if (!email || !emailInput?.checkValidity()) {
      emailInput?.reportValidity();
      return;
    }

    if (errorMessage) errorMessage.hidden = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Joining...";
    }

    try {
      await submitToMailerLite(form);
      showLetterFormSuccess();
    } catch {
      if (errorMessage) errorMessage.hidden = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = defaultButtonText;
      }
    }
  });
}



const JOURNAL_READ_KEY = "becoming366-journal-read";

function getReadJournalPosts() {
  try {
    const stored = localStorage.getItem(JOURNAL_READ_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isJournalPostRead(postId) {
  return getReadJournalPosts().includes(postId);
}

function markJournalPostRead(postId) {
  if (!postId) return;

  const readPosts = getReadJournalPosts();
  if (readPosts.includes(postId)) return;

  readPosts.push(postId);
  localStorage.setItem(JOURNAL_READ_KEY, JSON.stringify(readPosts));
}

function initJournalReadTracking() {
  const postId = document.body.dataset.journalPost;
  if (postId) {
    markJournalPostRead(postId);
  }

  document.querySelectorAll("[data-journal-id]").forEach((item) => {
    const id = item.dataset.journalId;
    if (!id || isJournalPostRead(id)) return;

    const category = item.querySelector(".journal-editorial-cat");
    if (!category) return;

    const meta = document.createElement("div");
    meta.className = "journal-editorial-meta";
    category.parentNode.insertBefore(meta, category);
    meta.appendChild(category);

    const badge = document.createElement("span");
    badge.className = "journal-new-badge";
    badge.textContent = "New";
    badge.setAttribute("aria-label", "Unread journal entry");
    meta.appendChild(badge);
  });
}

function initJournalFilter() {
  const categoryNav = document.querySelector(".journal-categories");
  const articles = document.querySelectorAll(".journal-list-item[data-category]");
  if (!categoryNav || articles.length === 0) return;

  const buttons = categoryNav.querySelectorAll(".journal-category");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.category;

      buttons.forEach((btn) => {
        const isActive = btn === button;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      articles.forEach((article) => {
        const show =
          filter === "all" || article.dataset.category === filter;
        article.hidden = !show;
      });
    });
  });
}



function initCarousels() {

  document.querySelectorAll(".image-carousel").forEach((carousel) => {

    const slides = [...carousel.querySelectorAll(".carousel-slide")];

    if (slides.length === 0) return;



    const dotsContainer = carousel.querySelector(".carousel-dots");

    let current = slides.findIndex((s) => s.classList.contains("active"));

    if (current < 0) {

      current = 0;

      slides[0].classList.add("active");

    }



    let dots = [];

    if (dotsContainer && slides.length > 1) {

      dotsContainer.innerHTML = "";

      slides.forEach((_, i) => {

        const dot = document.createElement("button");

        dot.type = "button";

        dot.className = "carousel-dot" + (i === current ? " active" : "");

        dot.setAttribute("aria-label", `Show image ${i + 1}`);

        dot.addEventListener("click", () => {

          goTo(i);

          resetTimer();

        });

        dotsContainer.appendChild(dot);

        dots.push(dot);

      });

    } else if (dotsContainer) {

      dotsContainer.style.display = "none";

    }



    const intervalMs = parseInt(carousel.dataset.interval || "4500", 10);

    let timer = null;



    function goTo(index) {

      slides[current].classList.remove("active");

      dots[current]?.classList.remove("active");

      current = ((index % slides.length) + slides.length) % slides.length;

      slides[current].classList.add("active");

      dots[current]?.classList.add("active");

    }



    function resetTimer() {

      if (slides.length <= 1) return;

      clearInterval(timer);

      timer = setInterval(() => goTo(current + 1), intervalMs);

    }



    if (slides.length > 1) {

      resetTimer();

      carousel.addEventListener("mouseenter", () => clearInterval(timer));

      carousel.addEventListener("mouseleave", resetTimer);

    }

  });

}

