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

function showLetterFormSuccess() {
  const formPanel = document.getElementById("letter-form-panel");
  const successPanel = document.getElementById("letter-form-success");
  const errorMessage = document.getElementById("letter-form-error");

  if (errorMessage) errorMessage.hidden = true;
  if (formPanel) formPanel.hidden = true;
  if (successPanel) successPanel.hidden = false;
}

function submitToMailerLite(email) {
  return new Promise((resolve, reject) => {
    const callbackName = `mlJsonp_${Date.now()}`;
    const script = document.createElement("script");
    const params = new URLSearchParams({
      "fields[email]": email,
      "ml-submit": "1",
      anticsrf: "true",
      callback: callbackName,
    });

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (response) => {
      cleanup();

      if (response && response.success === false) {
        reject(response);
        return;
      }

      resolve(response);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Network error"));
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timeout"));
    }, 15000);

    script.src = `${MAILERLITE_FORM_URL}?${params.toString()}`;
    document.body.appendChild(script);
  });
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
      await submitToMailerLite(email);
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

