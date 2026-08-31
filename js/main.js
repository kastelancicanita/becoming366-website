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

  initNewsletterPopup();

});



const NEWSLETTER_POPUP_KEY = "becoming366-newsletter-popup-seen";
const NEWSLETTER_POPUP_SCROLL_MS = 30000;
const NEWSLETTER_POPUP_MIN_SCROLL_Y = 100;

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

function hasNewsletterPopupSeen() {
  try {
    return localStorage.getItem(NEWSLETTER_POPUP_KEY) === "1";
  } catch {
    return false;
  }
}

function markNewsletterPopupSeen() {
  try {
    localStorage.setItem(NEWSLETTER_POPUP_KEY, "1");
  } catch {
    /* ignore storage errors */
  }

  closeNewsletterPopup();
}

function bindNewsletterForm(form, { onSuccess } = {}) {
  if (!form || form.dataset.newsletterBound === "true") return;

  form.dataset.newsletterBound = "true";

  const submitButton = form.querySelector('button[type="submit"]');
  const emailInput = form.querySelector('input[name="fields[email]"]');
  const errorMessage = form.querySelector(".letter-form-error");
  const defaultButtonText =
    submitButton?.textContent?.trim() || "Join the Letter →";

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
      markNewsletterPopupSeen();
      onSuccess?.();
    } catch {
      if (errorMessage) errorMessage.hidden = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = defaultButtonText;
      }
    }
  });
}

function initNewsletterForm() {
  const form = document.getElementById("becoming-letter-form");
  if (!form) return;

  bindNewsletterForm(form, { onSuccess: showLetterFormSuccess });
}

function ensureNewsletterPopup() {
  if (document.getElementById("newsletter-popup")) return;

  const popup = document.createElement("div");
  popup.id = "newsletter-popup";
  popup.className = "newsletter-popup";
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");
  popup.setAttribute("aria-labelledby", "newsletter-popup-title");

  popup.innerHTML = `
    <div class="newsletter-popup-backdrop" data-popup-close></div>
    <div class="newsletter-popup-panel">
      <button type="button" class="newsletter-popup-close" aria-label="Close newsletter popup">&times;</button>
      <p class="eyebrow">The Becoming Letter</p>
      <h2 id="newsletter-popup-title">Stay with me as we figure this out.</h2>
      <p class="newsletter-popup-lead">New Journal entries, personal notes, thoughts, and little reminders — sent to your inbox.</p>
      <div id="newsletter-popup-form-panel">
        <form class="letter-form" id="newsletter-popup-form" action="https://assets.mailerlite.com/jsonp/2606766/forms/197318874706740920/subscribe" method="post" novalidate>
          <input aria-label="Email address" aria-required="true" type="email" name="fields[email]" placeholder="Your email address" required autocomplete="email">
          <input type="hidden" name="ml-submit" value="1">
          <input type="hidden" name="anticsrf" value="true">
          <button type="submit" class="btn-accent">Join the Letter →</button>
          <p class="letter-form-error" hidden>Something went wrong. Please try again.</p>
        </form>
      </div>
      <div id="newsletter-popup-success" class="newsletter-popup-success" hidden>
        <p>Thank you — check your inbox to confirm your subscription.</p>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  popup.querySelector(".newsletter-popup-close")?.addEventListener("click", () => {
    markNewsletterPopupSeen();
  });

  popup.querySelector("[data-popup-close]")?.addEventListener("click", () => {
    markNewsletterPopupSeen();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      markNewsletterPopupSeen();
    }
  });

  bindNewsletterForm(popup.querySelector("#newsletter-popup-form"), {
    onSuccess: showNewsletterPopupSuccess,
  });
}

function showNewsletterPopupSuccess() {
  const formPanel = document.getElementById("newsletter-popup-form-panel");
  const successPanel = document.getElementById("newsletter-popup-success");
  const errorMessage = document.querySelector(
    "#newsletter-popup-form .letter-form-error"
  );

  if (errorMessage) errorMessage.hidden = true;
  if (formPanel) formPanel.hidden = true;
  if (successPanel) successPanel.hidden = false;
}

function openNewsletterPopup() {
  if (hasNewsletterPopupSeen()) return;

  ensureNewsletterPopup();

  const popup = document.getElementById("newsletter-popup");
  if (!popup || !popup.hidden) return;

  popup.hidden = false;
  document.body.classList.add("newsletter-popup-open");

  const emailInput = popup.querySelector('input[name="fields[email]"]');
  window.setTimeout(() => emailInput?.focus(), 150);
}

function closeNewsletterPopup() {
  const popup = document.getElementById("newsletter-popup");
  if (!popup) return;

  popup.hidden = true;
  document.body.classList.remove("newsletter-popup-open");
}

function initNewsletterPopup() {
  if (hasNewsletterPopupSeen()) return;

  let accumulatedScrollMs = 0;
  let lastScrollAt = null;
  let popupShown = false;

  const maybeShowPopup = () => {
    if (popupShown || hasNewsletterPopupSeen()) return;
    if (accumulatedScrollMs < NEWSLETTER_POPUP_SCROLL_MS) return;

    popupShown = true;
    openNewsletterPopup();
  };

  window.addEventListener(
    "scroll",
    () => {
      if (popupShown || hasNewsletterPopupSeen()) return;
      if (window.scrollY < NEWSLETTER_POPUP_MIN_SCROLL_Y) return;

      const now = performance.now();

      if (lastScrollAt !== null) {
        const gap = now - lastScrollAt;
        if (gap <= 300) {
          accumulatedScrollMs += gap;
        }
      }

      lastScrollAt = now;
      maybeShowPopup();
    },
    { passive: true }
  );

  window.setInterval(() => {
    if (popupShown || hasNewsletterPopupSeen()) return;
    if (window.scrollY < NEWSLETTER_POPUP_MIN_SCROLL_Y) return;
    if (lastScrollAt === null) return;

    const now = performance.now();
    if (now - lastScrollAt <= 300) {
      accumulatedScrollMs += 250;
      maybeShowPopup();
    }
  }, 250);
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

