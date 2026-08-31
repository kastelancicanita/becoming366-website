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



const NEWSLETTER_POPUP_DISMISSED_KEY = "becoming366-newsletter-popup-dismissed";
const NEWSLETTER_SUBSCRIBED_KEY = "becoming366-newsletter-subscribed";
const NEWSLETTER_POPUP_DELAY_MS = 30000;
const NEWSLETTER_POPUP_MIN_SCROLL_Y = 80;

const MAILERLITE_FORM_URL =
  "https://assets.mailerlite.com/jsonp/2606766/forms/197318874706740920/subscribe";

function initNewsletterStorage() {
  try {
    if (localStorage.getItem("becoming366-newsletter-popup-seen") === "1") {
      localStorage.setItem(NEWSLETTER_POPUP_DISMISSED_KEY, "1");
      localStorage.removeItem("becoming366-newsletter-popup-seen");
    }
  } catch {
    /* ignore storage errors */
  }
}

function showLetterFormSuccess() {
  const formPanel = document.getElementById("letter-form-panel");
  const successPanel = document.getElementById("letter-form-success");

  if (formPanel) {
    formPanel.hidden = true;
    formPanel.style.display = "none";
  }

  if (successPanel) {
    successPanel.hidden = false;
    successPanel.style.display = "block";
  }
}

function showNewsletterPopupSuccess() {
  const formPanel = document.getElementById("newsletter-popup-form-panel");
  const successPanel = document.getElementById("newsletter-popup-success");

  if (formPanel) {
    formPanel.hidden = true;
    formPanel.style.display = "none";
  }

  if (successPanel) {
    successPanel.hidden = false;
    successPanel.style.display = "block";
  }
}

function hasNewsletterPopupDismissed() {
  try {
    return localStorage.getItem(NEWSLETTER_POPUP_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function hasNewsletterSubscribed() {
  try {
    return localStorage.getItem(NEWSLETTER_SUBSCRIBED_KEY) === "1";
  } catch {
    return false;
  }
}

function markNewsletterPopupDismissed() {
  try {
    localStorage.setItem(NEWSLETTER_POPUP_DISMISSED_KEY, "1");
  } catch {
    /* ignore storage errors */
  }

  closeNewsletterPopup();
}

function markNewsletterSubscribed() {
  try {
    localStorage.setItem(NEWSLETTER_SUBSCRIBED_KEY, "1");
  } catch {
    /* ignore storage errors */
  }
}

function buildMailerLiteBody(form) {
  const body = new FormData(form);
  body.set("ajax", "1");
  return body;
}

async function submitNewsletterForm(form) {
  const body = buildMailerLiteBody(form);

  try {
    const response = await fetch(MAILERLITE_FORM_URL, {
      method: "POST",
      body,
      credentials: "omit",
    });

    const data = await response.json();

    if (data?.success) {
      return data;
    }

    throw data || new Error("Subscribe failed");
  } catch {
    return submitNewsletterFormViaIframe(form);
  }
}

function submitNewsletterFormViaIframe(form) {
  return new Promise((resolve, reject) => {
    const frameName = `ml-frame-${Date.now()}`;
    const iframe = document.createElement("iframe");
    iframe.name = frameName;
    iframe.style.cssText =
      "position:absolute;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);

    const tempForm = form.cloneNode(true);
    tempForm.target = frameName;
    tempForm.style.display = "none";
    document.body.appendChild(tempForm);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      tempForm.remove();
      iframe.remove();
    };

    iframe.onload = () => {
      try {
        const text = iframe.contentDocument?.body?.textContent?.trim() || "";
        const data = text ? JSON.parse(text) : { success: true };

        cleanup();

        if (data?.success) {
          resolve(data);
          return;
        }

        reject(data);
      } catch {
        cleanup();
        resolve({ success: true });
      }
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve({ success: true });
    }, 10000);

    tempForm.submit();
  });
}

function bindNewsletterForm(form, onSuccess) {
  if (!form || form.dataset.newsletterBound === "true") return;

  form.dataset.newsletterBound = "true";

  const submitButton = form.querySelector('button[type="submit"]');
  const emailInput = form.querySelector('input[name="fields[email]"]');
  const defaultButtonText =
    submitButton?.textContent?.trim() || "Join the Letter →";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput?.value.trim();
    if (!email || !emailInput?.checkValidity()) {
      emailInput?.reportValidity();
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Joining...";
    }

    try {
      await submitNewsletterForm(form);
      markNewsletterSubscribed();
      onSuccess?.();
    } catch {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = defaultButtonText;
      }

      window.alert("Something went wrong. Please try again.");
    }
  });
}

function initNewsletterForm() {
  const form = document.getElementById("becoming-letter-form");
  bindNewsletterForm(form, showLetterFormSuccess);
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
      <div id="mlb2-45397772-popup" class="ml-subscribe-form ml-subscribe-form-45397772">
        <div class="row-form" id="newsletter-popup-form-panel">
          <form class="letter-form ml-block-form" id="newsletter-popup-form" action="https://assets.mailerlite.com/jsonp/2606766/forms/197318874706740920/subscribe" method="post">
            <input aria-label="Email address" aria-required="true" type="email" name="fields[email]" placeholder="Your email address" required autocomplete="email">
            <input type="hidden" name="ml-submit" value="1">
            <input type="hidden" name="anticsrf" value="true">
            <button type="submit" class="btn-accent primary">Join the Letter →</button>
          </form>
        </div>
        <div class="row-success ml-block-success newsletter-popup-success" id="newsletter-popup-success" style="display: none">
          <p>Thank you — check your inbox to confirm your subscription.</p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  popup.querySelector(".newsletter-popup-close")?.addEventListener("click", () => {
    markNewsletterPopupDismissed();
  });

  popup.querySelector("[data-popup-close]")?.addEventListener("click", () => {
    markNewsletterPopupDismissed();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      markNewsletterPopupDismissed();
    }
  });

  bindNewsletterForm(
    popup.querySelector("#newsletter-popup-form"),
    showNewsletterPopupSuccess
  );
}

function openNewsletterPopup() {
  if (hasNewsletterPopupDismissed() || hasNewsletterSubscribed()) return;

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
  initNewsletterStorage();

  if (hasNewsletterPopupDismissed() || hasNewsletterSubscribed()) return;

  let timerStarted = false;

  const schedulePopup = () => {
    if (timerStarted || hasNewsletterPopupDismissed() || hasNewsletterSubscribed()) {
      return;
    }

    timerStarted = true;

    window.setTimeout(() => {
      if (!hasNewsletterPopupDismissed() && !hasNewsletterSubscribed()) {
        openNewsletterPopup();
      }
    }, NEWSLETTER_POPUP_DELAY_MS);
  };

  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY >= NEWSLETTER_POPUP_MIN_SCROLL_Y) {
        schedulePopup();
      }
    },
    { passive: true }
  );

  if (window.scrollY >= NEWSLETTER_POPUP_MIN_SCROLL_Y) {
    schedulePopup();
  }
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

