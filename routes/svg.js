import express from "express";
import { octokit } from "../utils/api.js";

const router = express.Router();

const escapeXml = (str = "") =>
  String(str).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

router.get("/", async (req, res) => {
  const username = (req.query.username || "johndoe").trim();

  try {
    const { data: user } = await octokit.rest.users.getByUsername({ username });
    const { data: authenticated } = await octokit.rest.users.getAuthenticated();
    const isOwnProfile =
      authenticated?.login?.toLowerCase() === username.toLowerCase();

    // Repositories (public + private when allowed)
    let page = 1;
    let hasMore = true;
    const repos = [];
    while (hasMore) {
      if (isOwnProfile) {
        const { data } = await octokit.rest.repos.listForAuthenticatedUser({
          per_page: 100,
          page,
          affiliation: "owner",
          sort: "pushed",
        });
        repos.push(
          ...data.filter(
            (repo) => repo.owner?.login?.toLowerCase() === username.toLowerCase()
          )
        );
        hasMore = data.length === 100;
      } else {
        const { data } = await octokit.rest.repos.listForUser({
          username,
          per_page: 100,
          page,
        });
        repos.push(...data);
        hasMore = data.length === 100;
      }
      page += 1;
    }

    const publicRepos = repos.filter((repo) => !repo.private);
    const privateRepos = repos.filter((repo) => repo.private);

    // Recent followers (5 most recent)
    let recentFollowers = [];
    try {
      const { data: followers } = await octokit.rest.users.listFollowersForUser({
        username,
        per_page: 5,
      });
      recentFollowers = followers.map((f) => escapeXml(f.login || "unknown"));
    } catch {
      // ignore if followers can't be fetched
    }

    // Recent public repos (5 most recently pushed)
    const recentPublicRepos = publicRepos
      .sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0))
      .slice(0, 5)
      .map((repo) => escapeXml(repo.name || "unknown"));

    // Recent private repos (5 most recently pushed)
    const recentPrivateRepos = privateRepos
      .sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0))
      .slice(0, 5)
      .map((repo) => escapeXml(repo.name || "unknown"));

    // Languages (percentages)
    const languages = {};
    for (const repo of publicRepos.slice(0, 40)) {
      try {
        const { data } = await octokit.rest.repos.listLanguages({
          owner: username,
          repo: repo.name,
        });
        for (const [lang, bytes] of Object.entries(data)) {
          languages[lang] = (languages[lang] || 0) + bytes;
        }
      } catch {
        // ignore archived/permission errors
      }
    }
    const totalLangBytes = Object.values(languages).reduce((a, b) => a + b, 0);
    const langEntries = Object.entries(languages)
      .map(([k, v]) => [k, (v / (totalLangBytes || 1)) * 100])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Contributions
    const contribQuery = `
      query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks { contributionDays { date, contributionCount } }
            }
          }
        }
      }
    `;
    const contribResp = await octokit.graphql(contribQuery, { login: username });
    const calendar = contribResp.user.contributionsCollection.contributionCalendar;
    const days = [];
    for (const w of calendar.weeks) {
      for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
    }
    const activeDays = days.filter((d) => d.count > 0).length;
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count > 0) streak++;
      else break;
    }

    // ACTIVITY (recent 3 public events)
    const { data: events } = await octokit.rest.activity.listPublicEventsForUser({
      username,
      per_page: 5,
    });
    const recent = events.map((e) => ({
      repo: escapeXml(e.repo?.name || e.repo?.full_name || "unknown"),
      type: e.type || "Activity",
      date: (e.created_at || "").slice(0, 10),
    }));

    // PROFILE blocks (skills + contacts) – consistent with Profile.jsx
    const skills = {
      languages: ["HTML", "CSS", "JavaScript"],
      frontend: ["React", "Next.js", "Vite", "Tailwind CSS"],
      backend: ["Node.js", "Express.js", "MongoDB", "Firebase", "EmailJs"],
      tools: ["Git", "Github", "VS Code"],
      host: ["Render", "Vercel", "Hostinger", "Netlify"],
    };
    const contacts = [
      { label: "Gmail", value: "johndoe@gmail.com" },
      { label: "LinkedIn", value: "linkedin.com/in/johndoe" },
    ];
    const aboutParagraphs = [
      "I’m a results-driven software engineer with strong expertise in modern web technologies and a focus on developing responsive, high-performance applications.",
      "I specialize in creating clean, maintainable, and visually consistent user interfaces while ensuring optimal functionality and scalability on the backend.",
      "With hands-on experience across the MERN ecosystem and tools like React.js, Next.js, Vite, and Tailwind CSS, I approach every project with precision, problem-solving, and a commitment to best development practices.",
      "I continuously refine my skills to stay aligned with emerging technologies and industry standards, aiming to deliver solutions that balance design, performance, and reliability.",
    ];

    // SVG canvas
    const width = 900;
    const height = 1800;

    const langBars = langEntries
      .map(
        ([name, pct], i) => `
      <g transform="translate(0, ${i * 24})">
        <text x="0" y="14" fill="#E5E7EB" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(
          name
        )}</text>
        <rect x="110" y="4" width="${Math.max(2, (pct / 100) * 200)}" height="10" rx="5" fill="#38BDF8"/>
        <text x="${110 + Math.max(2, (pct / 100) * 200) + 8}" y="14" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">${pct.toFixed(
          1
        )}%</text>
      </g>`
      )
      .join("");

    const activityRows = recent
      .map(
        (a, i) => `
      <g transform="translate(0, ${i * 20})">
        <text x="40" y="10" fill="#E5E7EB" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">${a.repo}</text>
        <text x="410" y="10" fill="#A5B4FC" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">${a.type}</text>
        <text x="780" y="10" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif"  text-anchor="end">${a.date}</text>
      </g>`
      )
      .join("");

    const skillSections = [
      { title: "Programming Languages & Markup", items: skills.languages },
      { title: "Frontend Technologies & Frameworks", items: skills.frontend },
      { title: "Backend, Databases & APIs", items: skills.backend },
      { title: "Tools & Version Control", items: skills.tools },
      { title: "Deployment & Hosting", items: skills.host },
    ];

    const skillBlocks = skillSections
      .map(
        (section, idx) => `
      <g transform="translate(0, ${idx * 66})">
  <text x="0" y="16" fill="#FACC15" font-size="13" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="600">
    ${escapeXml(section.title)}
  </text>
  ${section.items
            .map(
              (item, itemIdx) => `
      <rect x="${itemIdx * 140}" y="28" width="100" height="24" rx="12" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
      <text 
        x="${itemIdx * 140 + 50}" 
        y="40" 
        text-anchor="middle" 
        dominant-baseline="middle" 
        fill="#E5E7EB" 
        font-size="12" 
        font-family="Segoe UI, Ubuntu, Sans-Serif">
        ${escapeXml(item)}
      </text>`
            )
            .join("")}
</g>`
      )
      .join("");

    const contactCardWidth = 188;
    const contactCardGap = 22;
    const contactSectionWidth =
      contacts.length * contactCardWidth + (contacts.length - 1) * contactCardGap;
    const contactOffset = Math.max(0, (828 - contactSectionWidth) / 2);

    const contactCards = contacts
      .map(
        (contact, idx) => `
      <g transform="translate(${contactOffset + idx * (contactCardWidth + contactCardGap)}, 0)" style="pointer-events: none;">
        <rect width="${contactCardWidth}" height="70" rx="18" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
        <text x="20" y="32" fill="#F8FAFC" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="600" style="pointer-events: none;">${escapeXml(
          contact.label
        )}</text>
        <text x="20" y="52" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif" style="pointer-events: none;">${escapeXml(
          contact.value
        )}</text>
      </g>`
      )
      .join("");

    const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(user.name || username)} • GitHub Overview</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0F172A"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="28" fill="url(#bg)" stroke="#1F2937"/>

  <!-- Header -->
  <text x="32" y="56" fill="#F8FAFC" font-size="28" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">👋 Hi, I'm ${escapeXml(
      user.name || username
    )}</text>
  <text x="32" y="84" fill="#A5B4FC" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(
      user.bio || "Software Developer | Building Scalable & User-Focused Web Applications"
    )}</text>

  <!-- About -->
  <g transform="translate(32, 110)">
  <rect width="828" height="280" rx="20" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
  <text x="20" y="40" fill="#FACC15" font-size="18" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="700">About Me</text>
  
  <foreignObject x="20" y="50" width="780" height="220">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#CBD5F5;font-size:13px;font-family:'Segoe UI', Ubuntu, Sans-Serif;line-height:1.5;">
      ${aboutParagraphs.map(p => `<p>${escapeXml(p)}</p>`).join("")}
    </div>
  </foreignObject>
  </g>

    <!-- Stat cards -->
  <g transform="translate(32, 402)">
    <rect width="260" height="205" rx="20" fill="rgba(15,23,42,0.68)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="38" fill="#38BDF8" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">Followers</text>
    <text x="20" y="68" fill="#F8FAFC" font-size="26" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${user.followers}</text>
    <text x="20" y="95" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="600">Recent 5:</text>
    ${recentFollowers.length > 0
        ? recentFollowers.map((follower, i) => `
        <text x="20" y="${115 + i * 18}" fill="#E5E7EB" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">• ${follower}</text>
      `).join("")
        : `<text x="20" y="115" fill="#64748B" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">No recent followers</text>`
      }
  </g>
  <g transform="translate(316, 402)">
    <rect width="260" height="205" rx="20" fill="rgba(15,23,42,0.68)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="38" fill="#34D399" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">Public Repositories</text>
    <text x="20" y="68" fill="#F8FAFC" font-size="26" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${publicRepos.length}</text>
    <text x="20" y="95" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="600">Recent 5:</text>
    ${recentPublicRepos.length > 0
        ? recentPublicRepos.map((repo, i) => `
        <text x="20" y="${115 + i * 18}" fill="#E5E7EB" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">• ${repo}</text>
      `).join("")
        : `<text x="20" y="115" fill="#64748B" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">No public repos</text>`
      }
  </g>
  <g transform="translate(600, 402)">
    <rect width="260" height="205" rx="20" fill="rgba(15,23,42,0.68)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="38" fill="#F97316" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">Private Repositories</text>
    <text x="20" y="68" fill="#F8FAFC" font-size="26" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${isOwnProfile ? privateRepos.length : "—"}</text>
    ${!isOwnProfile ? `<text x="20" y="86" fill="#94A3B8" font-size="11" font-family="Segoe UI, Ubuntu, Sans-Serif">Requires authenticated profile</text>` : `
      <text x="20" y="95" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="600">Recent 5:</text>
      ${recentPrivateRepos.length > 0
          ? recentPrivateRepos.map((repo, i) => `
          <text x="20" y="${115 + i * 18}" fill="#E5E7EB" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">• ${repo}</text>
        `).join("")
          : `<text x="20" y="115" fill="#64748B" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">No private repos</text>`
        }
    `}
  </g>

  <!-- Top Languages -->
  <g transform="translate(32, 620)">
    <rect width="828" height="150" rx="20" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="40" fill="#FACC15" font-size="18" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="700">Top Languages</text>
    <g transform="translate(16, 60)">
      ${langBars || `<text x="20" y="20" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">No language data</text>`}
    </g>
  </g>

  <!-- Contributions -->
  <g transform="translate(32, 783)">
  <rect width="828" height="190" rx="20" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
  <text x="20" y="38" fill="#FACC15" font-size="18" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="700">
    Contribution Overview
  </text>

  <g transform="translate(27, 60)">
    <rect width="240" height="96" rx="20" fill="rgba(15,23,42,0.68)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="38" fill="#38BDF8" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">Total Contributions</text>
    <text x="20" y="68" fill="#F8FAFC" font-size="26" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${calendar.totalContributions}</text>
  </g>

  <g transform="translate(294, 60)">
    <rect width="240" height="96" rx="20" fill="rgba(15,23,42,0.68)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="38" fill="#34D399" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">Active Days</text>
    <text x="20" y="68" fill="#F8FAFC" font-size="26" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${activeDays}</text>
  </g>

  <g transform="translate(561, 60)">
    <rect width="240" height="96" rx="20" fill="rgba(15,23,42,0.68)" stroke="rgba(148,163,184,0.35)"/>
    <text x="20" y="38" fill="#F97316" font-size="14" font-family="Segoe UI, Ubuntu, Sans-Serif">Current Streak</text>
    <text x="20" y="68" fill="#F8FAFC" font-size="26" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${streak} days</text>
  </g>
</g>

<!-- Recent Activity -->
<g transform="translate(32, 987)">
  <rect width="828" height="200" rx="20" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>

  <!-- Title -->
  <text x="20" y="38" fill="#FACC15" font-size="18" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="700">
    Recent Activity
  </text>

  <!-- Column Headers -->
  <text x="40" y="70" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">
    Repository
  </text>
  <text x="420" y="70" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">
    Event
  </text>
  <text x="760" y="70" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif" text-anchor="end">
    Date
  </text>

  <!-- Activity Rows -->
  <g transform="translate(0, 86)">
    ${activityRows || `
      <text x="40" y="16" fill="#94A3B8" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">
        No recent events
      </text>
    `}
  </g>
</g>

  <!-- Technical Skills -->
<g transform="translate(32, 1200)">
  <rect width="828" height="400" rx="20" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
  <text x="20" y="38" fill="#FACC15" font-size="18" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="700">
    Technical Skills
  </text>
  <g transform="translate(20, 60)">
    ${skillBlocks}
  </g>
</g>

<!-- Connect With Me -->
<g transform="translate(32, 1610)">
  <rect width="828" height="160" rx="20" fill="rgba(15,23,42,0.65)" stroke="rgba(148,163,184,0.35)"/>
  <text x="20" y="38" fill="#FACC15" font-size="18" font-family="Segoe UI, Ubuntu, Sans-Serif" font-weight="700">
    Connect With Me
  </text>
  <g transform="translate(0, 60)">
    ${contactCards}
  </g>
</g>
</svg>`;

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.send(svg);
  } catch (error) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.status(500).send(`
<svg width="600" height="140" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="140" rx="16" fill="#111827"/>
  <text x="24" y="64" fill="#F87171" font-size="16" font-family="Segoe UI, Ubuntu, Sans-Serif">
    Unable to generate SVG.
  </text>
  <text x="24" y="92" fill="#F87171" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">
    ${escapeXml(error.message || "Unexpected error")}
  </text>
</svg>`);
  }
});

export default router;
