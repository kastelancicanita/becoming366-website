# Becoming 366 — Setup Guide

This folder contains your website design (HTML/CSS). Follow these steps to put it live on your own `.com` domain with WordPress — so you can write blog posts and send newsletters without touching code.

---

## What you're building

| Feature | How it works |
|---------|--------------|
| **Landing page** | Home with hero, planner features, Etsy products |
| **Shop page** | All products linking to Etsy |
| **Blog** | You write posts in WordPress admin — each gets its own URL |
| **Newsletter** | MailerLite — subscribers get emailed when you publish |
| **Instagram links** | Each blog post URL can be shared directly |

**Example blog URL:** `https://becoming366.com/blog/welcome-to-becoming-366`

---

## Step 1 — Buy domain + hosting (Hostinger)

1. Go to [hostinger.com](https://www.hostinger.com)
2. Choose **Premium Web Hosting** or **Single** plan (~€2–3/month on promo)
3. When asked for domain, search: **becoming366.com** (or similar if taken)
4. Complete purchase — you'll get login details by email

**Cost:** ~€35–45 for the first year (domain + hosting)

---

## Step 2 — Install WordPress

1. Log in to **Hostinger hPanel**
2. Go to **Websites** → **Add Website**
3. Choose **WordPress** → follow the wizard
4. Set site title: **Becoming 366**
5. Create admin username + strong password (save these!)
6. WordPress installs in ~2 minutes

Your site will temporarily be at something like `becoming366.com` once DNS propagates (can take up to 24h, usually faster).

---

## Step 3 — Choose a WordPress theme

For a look close to this design:

1. In WordPress admin go to **Appearance → Themes → Add New**
2. Search **"Kadence"** or **"Astra"** — both free, fast, professional
3. Install and activate **Kadence** (recommended)

Then customize colors to match Becoming 366:
- Background cream: `#FAF7F2`
- Text charcoal: `#2A2826`
- Accent gold: `#B8956A`
- Sage green: `#7D8B6F`

**Fonts:** Cormorant Garamond (headings) + DM Sans (body) — add via **Appearance → Customize → Typography** or Kadence's font settings.

---

## Step 4 — Create your pages

In WordPress admin: **Pages → Add New**

Create these pages (copy text from the HTML files in this folder):

| Page | Slug | Content source |
|------|------|------------------|
| Home | `/` (set as homepage) | `index.html` |
| Shop | `/shop` | `shop.html` |
| Blog | `/blog` | WordPress handles this automatically |

**Set homepage:**
- **Settings → Reading →** "A static page" → Home = Home, Posts page = Blog

**Navigation menu:**
- **Appearance → Menus** → add Home, Shop, Blog, and a custom link to `https://www.etsy.com/shop/becoming366` labeled "Etsy"

---

## Step 5 — Etsy product links

Every "Shop on Etsy" button should link to:
```
https://www.etsy.com/shop/becoming366
```

In WordPress, use **Kadence Blocks** or regular buttons with that URL. No need to rebuild a shop — Etsy handles payments.

When you add new Etsy products later, just add a new card/block on the Shop page. Takes 2 minutes.

---

## Step 6 — Blog (your weekly posts)

1. In WordPress: **Posts → Add New**
2. Write title, content, add a featured image
3. Click **Publish**
4. WordPress automatically creates a URL like:
   `becoming366.com/welcome-to-becoming-366/`
5. Share that exact link on Instagram

**Each post = its own link.** Perfect for Stories, bio, and posts.

### Comments (optional)
- **Settings → Discussion** → enable comments on posts
- Or install **Disqus** plugin for nicer comment threads

---

## Step 7 — Newsletter (MailerLite)

1. Create free account at [mailerlite.com](https://www.mailerlite.com) (free up to 1,000 subscribers)
2. Create a **Embedded form** → copy the HTML code
3. In WordPress install plugin **"MailerLite – Signup forms"**
4. Paste form on Home, Blog, and Shop pages (or use MailerLite widget in footer)

**Auto-email on new post:**
1. In MailerLite: **Automations → Create** → "When RSS feed updates, send email"
2. Your WordPress RSS feed is: `https://becoming366.com/feed/`
3. Now every time you publish a post, subscribers get notified automatically

---

## Step 8 — Connect Instagram

Add these links in your footer and bio:
- Website: `https://becoming366.com`
- Instagram: `https://www.instagram.com/becoming_366/`
- Etsy: `https://www.etsy.com/shop/becoming366`

---

## Step 9 — Preview this design locally (optional)

Before WordPress is live, you can preview the HTML design:

1. Open folder `becoming366-website` on your computer
2. Double-click `index.html` — opens in your browser
3. Click through Home, Shop, Blog to see the full design

This is your visual reference when building pages in WordPress.

---

## Checklist

- [ ] Domain purchased (becoming366.com)
- [ ] WordPress installed on Hostinger
- [ ] Kadence theme activated + colors/fonts set
- [ ] Home, Shop pages created
- [ ] Blog set as posts page
- [ ] Menu with Etsy link
- [ ] MailerLite newsletter form added
- [ ] RSS automation connected
- [ ] First blog post published
- [ ] Instagram bio updated with website link

---

## Need help?

When you're on any step, message me with:
- Which step you're on
- Screenshot if something looks wrong

I'll walk you through it.

---

## Files in this folder

```
becoming366-website/
├── index.html          ← Homepage design
├── shop.html           ← Shop page design
├── blog.html           ← Blog listing design
├── blog/
│   └── welcome-to-becoming-366.html  ← Sample blog post
├── css/style.css       ← All styling
├── js/main.js          ← Mobile menu, newsletter placeholder
└── WORDPRESS-SETUP.md  ← This guide
```
