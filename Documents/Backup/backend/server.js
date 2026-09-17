"use strict";
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const http = require("http");
const fsp = fs.promises;
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const xlsx = require("xlsx");

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key) {
        return;
      }
      let value = trimmed.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch (error) {
    console.warn("Failed to load env file:", filePath, error.message);
  }
}

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const HOST = String(process.env.HOST || "0.0.0.0");
const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "").trim();
const FRONTEND_URL = String(process.env.FRONTEND_URL || "").trim();
const APP_BASE_URL = String(process.env.APP_BASE_URL || "").trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || "").trim();
const AUTH_TOKEN_EXPIRY = Number(process.env.AUTH_TOKEN_EXPIRY || 1800000);
const TURNSTILE_SITE_KEY = String(process.env.TURNSTILE_SITE_KEY || "").trim();
const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
const IS_PRODUCTION = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const MAX_TOKENS_PER_USER = 5;
const ROOT_DIR = path.resolve(__dirname, "..");
function resolveFrontendDir() {
  const custom = String(process.env.FRONTEND_DIR || "").trim();
  if (custom && fs.existsSync(custom)) {
    return path.resolve(custom);
  }
  return path.join(ROOT_DIR, "frontend");
}
const FRONTEND_DIR = resolveFrontendDir();
const UPLOADS_DIR = process.env.UPLOADS_DIR && fs.existsSync(process.env.UPLOADS_DIR) ? path.resolve(process.env.UPLOADS_DIR) : path.join(FRONTEND_DIR, "uploads");
const DATA_DIR = path.join(ROOT_DIR, "backend", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const FACULTY_FILE = path.join(DATA_DIR, "faculty.json");
const PORTAL_FILE = path.join(DATA_DIR, "portal.json");
const SITE_FILE = path.join(DATA_DIR, "site.json");
const VISITORS_FILE = path.join(DATA_DIR, "visitors.json");

const dashboardStreamClients = new Set();
let portalFileWatcherStarted = false;
let mailTransporter = null;
const loginAttempts = new Map();
const passwordResetAttempts = new Map();
const visitorSessions = new Set();
let visitorCountCache = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultAdministrationPeopleGroups() {
  return [
    {
      id: "administration-leadership",
      title: "Head of the Department",
      items: [
        {
          id: "administration-hod",
          name: "Prof. [Name]",
          designation: "Head, Department of Physics",
          office: "Office: Physics Building, IIT Kharagpur",
          email: "head_phy@iitkgp.ac.in"
        }
      ]
    },
    {
      id: "administration-operations",
      title: "Department Administration",
      items: [
        {
          id: "administration-academics",
          name: "Prof. [Faculty Name]",
          designation: "Faculty In-charge (Academics)",
          office: "Room 201, Physics Building",
          email: "fic_academics_phy@iitkgp.ac.in"
        },
        {
          id: "administration-research",
          name: "Prof. [Faculty Name]",
          designation: "Faculty In-charge (Research)",
          office: "Room 305, Physics Building",
          email: "fic_research_phy@iitkgp.ac.in"
        },
        {
          id: "administration-admin-officer",
          name: "[Staff Name]",
          designation: "Senior Administrative Officer",
          office: "Department Office, Physics Building",
          email: "phyoffice@phy.iitkgp.ac.in"
        },
        {
          id: "administration-office-superintendent",
          name: "[Staff Name]",
          designation: "Office Superintendent",
          office: "Department Office, Physics Building",
          email: "phyoffice@phy.iitkgp.ac.in"
        }
      ]
    },
    {
      id: "administration-committee",
      title: "Committee",
      items: []
    }
  ];
}

function getDefaultPostdocPeopleGroups() {
  return [
    {
      id: "postdocs-current",
      title: "Postdocs",
      items: []
    },
    {
      id: "ramunanjan-current",
      title: "Ramunanjan",
      items: []
    }
  ];
}

function getDefaultStudentsPeopleGroups() {
  return [
    {
      id: "students-current",
      title: "Students",
      items: []
    }
  ];
}

function getDefaultAlumniPeopleGroups() {
  return [
    {
      id: "alumni-phd",
      title: "Ph.D. Scholars",
      items: [
        { id: "alumni-rahul-sharma", name: "Rahul Sharma", designation: "Condensed Matter Physics", topic: "Nanomaterials", office: "Supervisor: Prof. A. Kumar", email: "rahul.sharma[at]iitkgp[dot]ac[dot]in", category: "Ph.D. Scholars", photo: "" },
        { id: "alumni-priya-nair", name: "Priya Nair", designation: "High Energy Physics", topic: "Particle Phenomenology", office: "Supervisor: Prof. S. Banerjee", email: "priya.nair[at]iitkgp[dot]ac[dot]in", category: "Ph.D. Scholars", photo: "" },
        { id: "alumni-deepak-verma", name: "Deepak Verma", designation: "Condensed Matter Physics", topic: "Superconductivity", office: "Supervisor: Prof. A. Kumar", email: "deepak.verma[at]iitkgp[dot]ac[dot]in", category: "Ph.D. Scholars", photo: "" },
        { id: "alumni-meera-iyer", name: "Meera Iyer", designation: "Astrophysics", topic: "Cosmology", office: "Supervisor: Prof. R. Ghosh", email: "meera.iyer[at]iitkgp[dot]ac[dot]in", category: "Ph.D. Scholars", photo: "" }
      ]
    },
    {
      id: "alumni-mtech",
      title: "M.Tech Students",
      items: [
        { id: "alumni-amit-das", name: "Amit Das", designation: "Astrophysics", topic: "Compact Objects", office: "Supervisor: Prof. R. Ghosh", email: "amit.das[at]iitkgp[dot]ac[dot]in", category: "M.Tech Students", photo: "" },
        { id: "alumni-vikram-singh", name: "Vikram Singh", designation: "Quantum Information", topic: "Quantum Computing", office: "Supervisor: Prof. D. Sen", email: "vikram.singh[at]iitkgp[dot]ac[dot]in", category: "M.Tech Students", photo: "" },
        { id: "alumni-kavita-reddy", name: "Kavita Reddy", designation: "Materials Physics", topic: "Photovoltaics", office: "Supervisor: Prof. M. Patel", email: "kavita.reddy[at]iitkgp[dot]ac[dot]in", category: "M.Tech Students", photo: "" },
        { id: "alumni-siddharth-pal", name: "Siddharth Pal", designation: "Astrophysics", topic: "Gravitational Waves", office: "Supervisor: Prof. K. Majumdar", email: "siddharth.pal[at]iitkgp[dot]ac[dot]in", category: "M.Tech Students", photo: "" }
      ]
    },
    {
      id: "alumni-ms",
      title: "MS (Research)",
      items: [
        { id: "alumni-ananya-roy", name: "Ananya Roy", designation: "Computational Physics", topic: "DFT Simulations", office: "Supervisor: Prof. P. Mukherjee", email: "ananya.roy[at]iitkgp[dot]ac[dot]in", category: "MS (Research)", photo: "" },
        { id: "alumni-sourav-mondal", name: "Sourav Mondal", designation: "High Energy Physics", topic: "Lattice QCD", office: "Supervisor: Prof. T. Bhattacharya", email: "sourav.mondal[at]iitkgp[dot]ac[dot]in", category: "MS (Research)", photo: "" },
        { id: "alumni-arjun-mehta", name: "Arjun Mehta", designation: "Quantum Information", topic: "Entanglement Theory", office: "Supervisor: Prof. D. Sen", email: "arjun.mehta[at]iitkgp[dot]ac[dot]in", category: "MS (Research)", photo: "" },
        { id: "alumni-pooja-kumari", name: "Pooja Kumari", designation: "Condensed Matter Physics", topic: "Spintronics", office: "Supervisor: Prof. S. Datta", email: "pooja.kumari[at]iitkgp[dot]ac[dot]in", category: "MS (Research)", photo: "" }
      ]
    },
    {
      id: "alumni-msc",
      title: "Integrated M.Sc.",
      items: [
        { id: "alumni-sneha-gupta", name: "Sneha Gupta", designation: "Materials Physics", topic: "Thin Films", office: "Supervisor: Prof. M. Patel", email: "sneha.gupta[at]iitkgp[dot]ac[dot]in", category: "Integrated M.Sc.", photo: "" },
        { id: "alumni-tanvi-joshi", name: "Tanvi Joshi", designation: "Computational Physics", topic: "Molecular Dynamics", office: "Supervisor: Prof. P. Mukherjee", email: "tanvi.joshi[at]iitkgp[dot]ac[dot]in", category: "Integrated M.Sc.", photo: "" },
        { id: "alumni-nikhil-chatterjee", name: "Nikhil Chatterjee", designation: "Condensed Matter Physics", topic: "Topological Insulators", office: "Supervisor: Prof. S. Datta", email: "nikhil.chatterjee[at]iitkgp[dot]ac[dot]in", category: "Integrated M.Sc.", photo: "" },
        { id: "alumni-ritu-agarwal", name: "Ritu Agarwal", designation: "High Energy Physics", topic: "Neutrino Physics", office: "Supervisor: Prof. S. Banerjee", email: "ritu.agarwal[at]iitkgp[dot]ac[dot]in", category: "Integrated M.Sc.", photo: "" }
      ]
    }
  ];
}

function normalizePeopleGroups(groups, fallbackGroups) {
  const source = Array.isArray(groups) && groups.length ? groups : deepClone(fallbackGroups || []);
  return source.map((group, groupIndex) => ({
    id: String((group && group.id) || `people-group-${groupIndex + 1}`).trim(),
    title: String((group && group.title) || `Group ${groupIndex + 1}`).trim(),
    items: Array.isArray(group && group.items)
      ? group.items.map((item, itemIndex) => ({
        id: String((item && item.id) || `person-${groupIndex + 1}-${itemIndex + 1}`).trim(),
        name: String((item && item.name) || "").trim(),
        designation: String((item && item.designation) || "").trim(),
        office: String((item && item.office) || "").trim(),
        email: String((item && item.email) || "").trim(),
        contact: String((item && item.contact) || "").trim(),
        topic: String((item && item.topic) || "").trim(),
        category: String((item && item.category) || "").trim(),
        photo: String((item && item.photo) || "").trim()
      }))
      : []
  }));
}

function normalizeCustomSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .map((section, index) => ({
      id: String((section && section.id) || `custom-section-${index + 1}`).trim(),
      title: String((section && section.title) || "").trim(),
      content: String((section && section.content) || "").trim()
    }))
    .filter((section) => section.title || section.content);
}

function stripHtmlTags(str) {
  if (!str || typeof str !== 'string') return '';
  if (!/<[a-z][\s\S]*>/i.test(str)) return str.trim();
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeFacultyEntries(entries) {
  // NOTE: facultyId is NEVER auto-generated from the array index here.
  // Auto-generating by index caused identity to shift whenever entries were reordered,
  // leading to the wrong profile being matched and shown.
  return (Array.isArray(entries) ? entries : []).map((item) => ({
    facultyId: String((item && item.facultyId) || "").trim(),
    loginId: String((item && item.loginId) || "").trim(),
    initialPassword: String((item && item.initialPassword) || "").trim(),
    name: String((item && item.name) || "").trim(),
    designation: String((item && item.designation) || "").trim(),
    email: String((item && item.email) || "").trim(),
    phone: String((item && item.phone) || "").trim(),
    office: String((item && item.office) || "").trim(),
    specialization: String((item && item.specialization) || "").trim(),
    bio: String((item && item.bio) || "").trim(),
    photoDataUrl: String((item && item.photoDataUrl) || "").trim(),
    department: String((item && item.department) || "Department of Physics").trim(),
    subgroup: String((item && item.subgroup) || "").trim(),
    researchInterest: String((item && item.researchInterest) || "").trim(),
    researchTeam: String((item && item.researchTeam) || "").trim(),
    researchTeamPostdocs: String((item && item.researchTeamPostdocs) || "").trim(),
    researchTeamStudents: String((item && item.researchTeamStudents) || "").trim(),
    publications: String((item && item.publications) || "").trim(),
    coursesTaught: String((item && item.coursesTaught) || "").trim(),
    industryCollaborations: String((item && item.industryCollaborations) || "").trim(),
    awardsAndHonors: String((item && item.awardsAndHonors) || "").trim(),
    showCoursesTaught: Boolean(item && item.showCoursesTaught),
    showIndustryCollaborations: Boolean(item && item.showIndustryCollaborations),
    showAwardsAndHonors: Boolean(item && item.showAwardsAndHonors),
    otherLinks: String((item && item.otherLinks) || "").trim(),
    researchCluster: String((item && item.researchCluster) || "").trim(),
    customSections: normalizeCustomSections(item && item.customSections)
  }));
}

function isPublicFacultyEntry(item) {
  // facultyId is no longer required — entries created before facultyId assignment
  // are still valid if they have at least a loginId (or email) and a name.
  return Boolean(
    item
    && (String(item.loginId || "").trim() || String(item.facultyId || "").trim())
    && String(item.name || "").trim()
    && String(item.email || "").trim()
  );
}

function hasPublishedFacultyDetails(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  return Boolean(
    String(item.designation || "").trim()
    || String(item.phone || "").trim()
    || String(item.office || "").trim()
    || String(item.specialization || "").trim()
    || String(item.researchInterest || "").trim()
    || String(item.bio || "").trim()
    || String(item.publications || "").trim()
    || String(item.coursesTaught || "").trim()
    || String(item.industryCollaborations || "").trim()
    || String(item.awardsAndHonors || "").trim()
    || (Array.isArray(item.customSections) && item.customSections.some((section) => String(section && (section.title || section.content) || "").trim()))
    || String(item.photoDataUrl || "").trim()
  );
}

function isSameFacultyProfile(item, user) {
  if (!item || !user) {
    return false;
  }
  const profileFacultyId = String(item.facultyId || "").trim();
  const userFacultyId = String(user.facultyId || "").trim();
  if (profileFacultyId && userFacultyId && profileFacultyId === userFacultyId) {
    return true;
  }

  const profileLoginId = normalizeCredential(item.loginId);
  const userLoginId = normalizeCredential(user.loginId);
  if (profileLoginId && userLoginId && profileLoginId === userLoginId) {
    return true;
  }

  const profileEmail = normalizeEmail(item.email);
  const userEmail = normalizeEmail(user.email);
  if (profileEmail && userEmail && profileEmail === userEmail) {
    return true;
  }

  return false;
}

function buildPublicFacultyEntries(users, facultyEntries) {
  const byEmail = new Map();
  const byFacultyId = new Map();
  const byLoginId = new Map();
  const normalizedFaculty = normalizeFacultyEntries(facultyEntries);

  normalizedFaculty.forEach((entry) => {
    const emailKey = normalizeEmail(entry.email);
    const facultyKey = String(entry.facultyId || "").trim();
    const loginKey = normalizeCredential(entry.loginId);
    if (emailKey) {
      byEmail.set(emailKey, entry);
    }
    if (facultyKey) {
      byFacultyId.set(facultyKey, entry);
    }
    if (loginKey) {
      byLoginId.set(loginKey, entry);
    }
  });

  const activePortalUsers = (Array.isArray(users) ? users : []).filter((user) => {
    if (!user || (user.role !== "faculty" && user.role !== "admin")) {
      return false;
    }
    return String(user.status || "").trim().toLowerCase() === "active";
  });

  const merged = activePortalUsers.map((user) => {
    const profile =
      byFacultyId.get(String(user.facultyId || "").trim()) ||
      byLoginId.get(normalizeCredential(user.loginId)) ||
      byEmail.get(normalizeEmail(user.email)) ||
      null;
    const entry = {
      facultyId: String((profile && profile.facultyId) || user.facultyId || "").trim(),
      loginId: String((profile && profile.loginId) || user.loginId || "").trim(),
      initialPassword: "",
      name: String((profile && profile.name) || user.name || "").trim(),
      designation: String((profile && profile.designation) || "").trim(),
      email: normalizeEmail((profile && profile.email) || user.email),
      phone: String((profile && profile.phone) || "").trim(),
      office: String((profile && profile.office) || "").trim(),
      specialization: String((profile && profile.specialization) || (profile && profile.researchInterest) || "").trim(),
      bio: String((profile && profile.bio) || "").trim(),
      photoDataUrl: String((profile && profile.photoDataUrl) || "").trim(),
      department: String((profile && profile.department) || "Department of Physics").trim(),
      subgroup: String((profile && profile.subgroup) || "").trim(),
      researchInterest: String((profile && profile.researchInterest) || "").trim(),
      researchTeam: String((profile && profile.researchTeam) || "").trim(),
      researchTeamPostdocs: String((profile && profile.researchTeamPostdocs) || "").trim(),
      researchTeamStudents: String((profile && profile.researchTeamStudents) || "").trim(),
      publications: String((profile && profile.publications) || "").trim(),
      coursesTaught: String((profile && profile.coursesTaught) || "").trim(),
      industryCollaborations: String((profile && profile.industryCollaborations) || "").trim(),
      awardsAndHonors: String((profile && profile.awardsAndHonors) || "").trim(),
      showCoursesTaught: Boolean(profile && profile.showCoursesTaught),
      showIndustryCollaborations: Boolean(profile && profile.showIndustryCollaborations),
      showAwardsAndHonors: Boolean(profile && profile.showAwardsAndHonors),
      otherLinks: String((profile && profile.otherLinks) || "").trim(),
      customSections: normalizeCustomSections(profile && profile.customSections)
    };
    return entry;
  }).filter((entry) => String(entry.name || "").trim() && String(entry.email || "").trim() && hasPublishedFacultyDetails(entry));

  // Deduplicate the merged list: multiple portal user accounts can resolve to the
  // same faculty profile (same facultyId or same email). Keep only the first match
  // per facultyId and per email so a person never appears more than once.
  const seenFacultyIds = new Set();
  const seenMergedEmails = new Set();
  const deduped = merged.filter((entry) => {
    const fid = String(entry.facultyId || "").trim();
    const em = normalizeEmail(entry.email);
    if (fid && seenFacultyIds.has(fid)) { return false; }
    if (em && seenMergedEmails.has(em)) { return false; }
    if (fid) { seenFacultyIds.add(fid); }
    if (em) { seenMergedEmails.add(em); }
    return true;
  });

  const mappedEmails = new Set(deduped.map((entry) => normalizeEmail(entry.email)));
  const legacy = normalizedFaculty
    .filter((entry) => isPublicFacultyEntry(entry) && !mappedEmails.has(normalizeEmail(entry.email)))
    .filter((entry) => hasPublishedFacultyDetails(entry));

  return deduped.concat(legacy).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function createDefaultFacultyPassword(facultyId) {
  const cleaned = String(facultyId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-4) || "1234";
  return `Phy@${cleaned}`;
}

function createFacultyProfileFromUser(user) {
  return {
    facultyId: String(user.facultyId || "").trim(),
    loginId: String(user.loginId || "").trim(),
    initialPassword: "",
    name: String(user.name || "").trim(),
    designation: "",
    email: normalizeEmail(user.email),
    phone: "",
    office: "",
    specialization: "",
    bio: "",
    photoDataUrl: "",
    department: "Department of Physics",
    subgroup: "",
    researchInterest: "",
    researchTeam: "",
    researchTeamPostdocs: "",
    researchTeamStudents: "",
    publications: "",
    coursesTaught: "",
    industryCollaborations: "",
    awardsAndHonors: "",
    showCoursesTaught: false,
    showIndustryCollaborations: false,
    showAwardsAndHonors: false,
    otherLinks: "",
    customSections: []
  };
}

function getDefaultHomeCards() {
  return [
    { id: "home-card-research", title: "Research Areas", image: "research-areas.png", alt: "Research laboratory", href: "./research.html" },
    { id: "home-card-ug", title: "Undergraduate Program", image: "undergraduate-program.png", alt: "Classroom session", href: "./undergraduate-program.html" },
    { id: "home-card-pg", title: "Postgraduate Program", image: "postgraduate-program.png", alt: "Students at computer", href: "./postgraduate-program.html" },
    { id: "home-card-phd", title: "Doctoral Program", image: "doctoral-program.png", alt: "Doctoral presentation", href: "./doctoral-program.html" },
    { id: "home-card-labs", title: "Laboratories", image: "laboratories.png", alt: "Lab facilities", href: "./laboratories.html" },
    { id: "home-card-facilities", title: "Facilities", image: "facilities.png", alt: "Library hall", href: "./facilities.html" }
  ];
}

function getDefaultResearchCards() {
  return [
    { id: "research-card-condensed-matter", title: "Condensed Matter Physics", content: "Study of physical properties of matter in solid and soft phases.", image: "", alt: "", href: "./condensed-matter-physics.html" },
    { id: "research-card-high-energy", title: "High Energy Physics", content: "Exploration of fundamental particles and interactions.", image: "", alt: "", href: "./high-energy-physics.html" },
    { id: "research-card-astrophysics", title: "Astrophysics & Cosmology", content: "Understanding the universe from stellar systems to large-scale structures.", image: "", alt: "", href: "./astrophysics-cosmology.html" },
    { id: "research-card-complex-systems", title: "Complex Systems & Active Matter", content: "Study of collective behavior in biological and non-equilibrium systems.", image: "", alt: "", href: "./complex-systems.html" },
    { id: "research-card-nuclear", title: "Nuclear Physics", content: "Study of atomic nuclei, their structure, interactions, and energy processes.", image: "", alt: "", href: "./nuclear-physics.html" },
    { id: "research-card-quantum-information", title: "Quantum Information", content: "Exploration of information processing using the principles of quantum mechanics.", image: "", alt: "", href: "./quantum-information.html" }
  ];
}

function getDefaultManagedPages() {
  return [
    {
      id: "page-home",
      route: "/index.html",
      title: "Home Page",
      status: "published",
      summary: "Landing page content, notice placement, and visual highlights.",
      draft: "",
      sections: [
        { id: "home-hero", title: "Hero Section", subtitle: "Main banner with heading and image", content: "Advance research, academic excellence, and interdisciplinary learning from one connected departmental hub.", image: "home-hero.png" },
        { id: "home-announcements", title: "Announcements", subtitle: "Important notices and updates", content: "Public announcement area for notices and updates shown on the homepage.", image: "home-hero-sign.png" },
        { id: "home-news", title: "News & Events", subtitle: "Latest news and upcoming events", content: "Highlight the latest department events, seminars, awards, and important updates.", image: "home-hero-gate.png" },
        { id: "home-featured-research", title: "Featured Research", subtitle: "Highlighted research work", content: "Showcase major research highlights, discoveries, and featured lab work on the homepage.", image: "" },
        { id: "home-courses", title: "Courses", subtitle: "Course offerings and details", content: "Present quick information about undergraduate, postgraduate, and doctoral course offerings.", image: "" },
        { id: "home-publications", title: "Publications", subtitle: "Recent publications", content: "Highlight recent publications, journals, and featured academic outputs from the department.", image: "" },
        { id: "home-quick-links", title: "Quick Links", subtitle: "Useful shortcuts", content: "Provide direct links to admissions, notices, directory, and other important sections.", image: "" }
      ],
      media: [],
      cards: getDefaultHomeCards()
    },
    {
      id: "page-about",
      route: "/about.html",
      title: "About Page",
      status: "published",
      summary: "Department history, growth, mission, and contact information.",
      draft: "",
      sections: [
        { id: "about-overview", title: "Department Overview", subtitle: "History and foundation", content: "The Department of Physics at the Indian Institute of Technology Kharagpur was established in 1951, alongside the inception of the institute. Beginning in the historic Hijli Detention Camp, the department quickly developed a strong foundation in teaching and research under pioneering faculty like Harsha Narayan Bose.\n\nOver the decades, the department expanded its academic programmes and research areas, building expertise across both theoretical and experimental physics. With the establishment of advanced laboratories and research facilities, it has grown into a major center for scientific research and education.\n\nToday, the department continues to contribute significantly to academic excellence, research output, and interdisciplinary initiatives, while adapting to emerging areas of science and technology.", image: "" },
        { id: "about-vision", title: "Vision and Mission", subtitle: "Academic direction and values", content: "Welcome to the Department of Physics at the Indian Institute of Technology Kharagpur. It is a privilege to be part of a department with a rich legacy of academic excellence and a vibrant research culture. We take pride in fostering an environment where students are encouraged to question, explore, and grow, supported by dedicated faculty and strong interdisciplinary collaboration. As we continue to evolve, our focus remains on nurturing thoughtful scientists and contributing meaningfully to the advancement of knowledge and society.", image: "" },
        { id: "about-contact", title: "Contact", subtitle: "Reach and locate the department", content: "Department of Physics\nIndian Institute of Technology Kharagpur\nKharagpur - 721302\nWest Bengal, India", image: "" }
      ],
      media: [
        { id: "about-hero", label: "About Hero Banner", src: "about-department-hero.png", alt: "Department of Physics building" },
        { id: "about-overview-image", label: "Overview Image", src: "about-history-classroom.png", alt: "Students in a classroom" },
        { id: "about-research-image", label: "Research Facility Image", src: "about-research-lab.png", alt: "Laboratory glassware" }
      ]
    },
    {
      id: "page-research",
      route: "/research.html",
      title: "Research Page",
      status: "published",
      summary: "Research areas, facilities, and project collaboration highlights.",
      draft: "The Department of Physics at IIT Kharagpur conducts research across a wide spectrum of theoretical, experimental, and interdisciplinary domains. The following areas represent the major research directions within the department.\n\nAdvanced laboratories, instrumentation, and shared facilities support high-quality experimental and computational work.\n\nThe department promotes ongoing projects and collaborations across institutions and disciplines.",
      sections: [
        { id: "research-clusters", title: "Research Clusters", subtitle: "Core focus areas", content: "The Department of Physics at IIT Kharagpur conducts research across a wide spectrum of theoretical, experimental, and interdisciplinary domains. The following areas represent the major research directions within the department.", image: "" },
        { id: "research-facilities", title: "Facilities", subtitle: "Instrumentation and labs", content: "Advanced laboratories, instrumentation, and shared facilities support high-quality experimental and computational work.", image: "" },
        { id: "research-projects", title: "Projects and Collaborations", subtitle: "Ongoing work and partnerships", content: "The department promotes ongoing projects and collaborations across institutions and disciplines.", image: "" }
      ],
      media: [
        { id: "research-hero", label: "Research Hero Banner", src: "research-hero.png", alt: "Research areas banner" }
      ],
      cards: getDefaultResearchCards()
    },
    {
      id: "page-programs",
      route: "/programs.html",
      title: "Programs Page",
      status: "published",
      summary: "Programme details, curriculum structure, and admissions guidance.",
      draft: "IIT Kharagpur has added yet another new programme at the undergraduate level. The newly established Department of Education of this institute offers the Integrated Teacher Education Programme (ITEP) from the academic session 2023-24.\n\nFour-year integrated programme\nDual specialization in Education and a disciplinary major\nCurriculum includes theoretical foundations, pedagogy, and subject specialization\nExposure to research-oriented and interdisciplinary learning\n\nAdmission through National Common Entrance Test (NCET) conducted by NTA. Candidates must satisfy eligibility and subject requirements as notified.",
      sections: [
        { id: "programs-overview", title: "Programs Overview", subtitle: "Academic offerings", content: "IIT Kharagpur has added yet another new programme at the undergraduate level. The newly established Department of Education of this institute offers the Integrated Teacher Education Programme (ITEP) from the academic session 2023-24.", image: "" },
        { id: "programs-curriculum", title: "Curriculum and Structure", subtitle: "Program flow and coursework", content: "Four-year integrated programme\nDual specialization in Education and a disciplinary major\nCurriculum includes theoretical foundations, pedagogy, and subject specialization\nExposure to research-oriented and interdisciplinary learning", image: "" },
        { id: "programs-admissions", title: "Admissions Guidance", subtitle: "Eligibility and intake", content: "Admission through National Common Entrance Test (NCET) conducted by NTA. Candidates must satisfy eligibility and subject requirements as notified.", image: "" }
      ],
      media: [
        { id: "programs-hero", label: "Programs Hero Banner", src: "programs-hero.png", alt: "Academic programmes banner" },
        { id: "programs-intro-image", label: "Programme Intro Image", src: "itep-programme.png", alt: "Integrated Teacher Education Programme" }
      ]
    },
    {
      id: "page-administration",
      route: "/administration.html",
      title: "Administration Page",
      status: "published",
      summary: "Administrative contacts, leadership roles, and departmental office information.",
      draft: "",
      sections: [
        { id: "administration-overview", title: "Administration", subtitle: "Department leadership and office contacts", content: "Administrative contacts and departmental leadership information.", image: "" }
      ],
      media: [],
      peopleGroups: getDefaultAdministrationPeopleGroups()
    },
    {
      id: "page-faculty",
      route: "/faculty.html",
      title: "Faculty Page",
      status: "published",
      summary: "Public directory that reflects faculty-managed profiles.",
      draft: "Faculty profiles, designations, contact information, and specialization details are managed through faculty and admin profile updates.",
      sections: [
        { id: "faculty-directory", title: "Faculty Directory", subtitle: "Profiles and listing", content: "Faculty directory is synced from admin profiles.", image: "" },
        { id: "faculty-specializations", title: "Specializations", subtitle: "Expertise and focus areas", content: "Faculty profiles include specialization and research focus details for public viewing.", image: "" },
        { id: "faculty-contact", title: "Contact Faculty", subtitle: "Reach faculty and staff", content: "Display contact details, office information, and research interests from faculty profiles.", image: "" }
      ],
      media: []
    },
    {
      id: "page-postdocs",
      route: "/postdocs.html",
      title: "Postdocs Page",
      status: "published",
      summary: "Postdoctoral researchers, affiliations, and contact details.",
      draft: "Postdoctoral researchers associated with the department are listed here with current role, office, and contact information.",
      sections: [
        { id: "postdocs-directory", title: "Postdocs", subtitle: "Researchers and fellows", content: "Postdoctoral researchers associated with the department.", image: "" }
      ],
      media: [],
      peopleGroups: getDefaultPostdocPeopleGroups()
    },
    {
      id: "page-contact",
      route: "/contact.html",
      title: "Contact Page",
      status: "published",
      summary: "Department address, administrative contacts, and location details.",
      draft: "Department of Physics, IIT Kharagpur contact details for visitors, students, and collaborators.",
      sections: [
        { id: "contact-address", title: "Department Address", subtitle: "Find and reach the department", content: "Department of Physics\nIndian Institute of Technology Kharagpur\nKharagpur - 721302\nWest Bengal, India", image: "" },
        { id: "contact-admin", title: "Administrative Contacts", subtitle: "Key office contacts", content: "Head of Department, Academic Office, and admissions contacts are available for academic and administrative queries.", image: "" },
        { id: "contact-location", title: "Location", subtitle: "Campus directions", content: "The Department of Physics is located within the academic zone of IIT Kharagpur campus and is accessible from Kharagpur Junction and NH-6.", image: "" }
      ],
      media: [
        { id: "contact-hero", label: "Contact Hero Banner", src: "contact-hero.png", alt: "Contact us banner" }
      ]
    },
    {
      id: "page-career",
      route: "/career.html",
      title: "Career Page",
      status: "published",
      summary: "Career opportunities, current openings, and application contact details.",
      draft: "The Department of Physics at IIT Kharagpur offers opportunities for individuals interested in teaching, research, and technical support roles.\n\nCurrent openings and role details are updated here.\n\nContact details for career and application related queries.",
      sections: [
        { id: "career-intro", title: "Work With Us", subtitle: "Opportunities overview", content: "The Department of Physics at IIT Kharagpur offers opportunities for individuals interested in teaching, research, and technical support roles.", image: "" },
        { id: "career-openings", title: "Current Openings", subtitle: "Latest positions", content: "Current openings and role details are updated here.", image: "" },
        { id: "career-contact", title: "Contact", subtitle: "Application queries", content: "Contact details for career and application related queries.", image: "" }
      ],
      media: [
        { id: "career-hero", label: "Career Hero Banner", src: "career-hero.png", alt: "Careers and opportunities banner" }
      ]
    },
    {
      id: "page-students",
      route: "/students.html",
      title: "Students Page",
      status: "published",
      summary: "Students of the Department of Physics.",
      draft: "Student listing managed by the superadmin.",
      sections: [
        { id: "students-overview", title: "Students", subtitle: "Students of the Department of Physics.", content: "Public student listing managed by the superadmin.", image: "" }
      ],
      media: [
        { id: "students-hero", label: "Students Hero", src: "students-hero.png", alt: "Students banner" }
      ],
      peopleGroups: getDefaultStudentsPeopleGroups()
    }
  ];
}

function toManagedPageSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.html$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapRouteToManagedPageId(routePath) {
  const route = String(routePath || "").trim().toLowerCase();
  const known = {
    "/index.html": "page-home",
    "/about.html": "page-about",
    "/research.html": "page-research",
    "/programs.html": "page-programs",
    "/administration.html": "page-administration",
    "/faculty.html": "page-faculty",
    "/postdocs.html": "page-postdocs",
    "/contact.html": "page-contact",
    "/career.html": "page-career",
    "/students.html": "page-students",
    "/graduate-students.html": "page-students"
  };
  if (known[route]) {
    return known[route];
  }
  const fileName = route.replace(/^\//, "");
  const slug = toManagedPageSlug(fileName);
  return `page-${slug || "public-page"}`;
}

function toTitleCaseFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildManagedPublicPageHtml(title, sectionTitle, sectionId) {
  const safeTitle = String(title || "Page").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSectionTitle = String(sectionTitle || `${safeTitle} Overview`).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSectionId = String(sectionId || "page-overview").replace(/[^a-zA-Z0-9-_]/g, "");
  const safeHeroId = `${safeSectionId}-hero-image`;
  const safeLeftId = `${safeSectionId}-left-image`;
  const safeRightId = `${safeSectionId}-right-image`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} | Department of Physics | IIT Kharagpur</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="./styles.css" />
  <script src="./search.js" defer></script>
</head>
<body class="about-page">
  <header class="top-header">
    <div class="container header-inner">
      <div class="brand">
        <img src="https://upload.wikimedia.org/wikipedia/en/1/1c/IIT_Kharagpur_Logo.svg" alt="IIT Kharagpur Logo" class="brand-logo" />
        <div class="brand-text">
          <h1>Department of Physics</h1>
          <p>Indian Institute of Technology Kharagpur</p>
        </div>
      </div>
      <form class="search-box" role="search" aria-label="Search pages">
        <button type="submit" class="search-icon" aria-label="Search">&#128269;</button>
        <input class="search-input" type="search" name="q" placeholder="Search" />
      </form>
    </div>
  </header>

  <nav class="main-nav">
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Toggle navigation">
      <span></span>
      <span></span>
      <span></span>
    </button>
    <div class="container nav-inner" id="primary-navigation">
      <a href="./index.html">HOME</a>
      <a href="./about.html">ABOUT</a>
      <div class="nav-dropdown">
        <a href="#" class="nav-dropbtn">PEOPLE</a>
                                <div class="nav-dropdown-menu">
          <a href="./faculty.html">Faculty</a>
          <a href="./postdocs.html">Researchers</a>
          <a href="./students.html">Students</a>
          <a href="./administration.html">Staff</a>
        </div>
      </div>
      <a href="./research.html">RESEARCH</a>
      <a href="./programs.html">PROGRAMS</a>
      <a href="./news-events.html">NEWS &amp; EVENTS</a>
      <a href="./graduate-students.html">ALUMNI</a>
      <a href="./career.html">CAREER</a>
    </div>
  </nav>

  <main class="about-main">
    <section id="${safeHeroId}-wrap" aria-label="${safeTitle} hero banner" style="display:none;">
      <img id="${safeHeroId}" src="" alt="${safeTitle} hero banner" style="width:100%;max-height:320px;object-fit:cover;display:block;" />
    </section>
    <div class="about-container">
      <section class="about-grid">
        <article class="about-card">
          <h2 id="${safeSectionId}-title">${safeSectionTitle}</h2>
          <p id="${safeSectionId}-content">Page content will be updated from Super Admin editor.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:20px;">
            <figure style="margin:0;">
              <img id="${safeLeftId}" src="" alt="${safeTitle} left content image" style="width:100%;border-radius:10px;display:none;" />
            </figure>
            <figure style="margin:0;">
              <img id="${safeRightId}" src="" alt="${safeTitle} right content image" style="width:100%;border-radius:10px;display:none;" />
            </figure>
          </div>
        </article>
      </section>
    </div>
  </main>

  <footer class="footer footer-about">
    <div class="container footer-grid">
      <section class="footer-brand">
        <img src="https://upload.wikimedia.org/wikipedia/en/1/1c/IIT_Kharagpur_Logo.svg" alt="IIT Kharagpur logo" />
        <div class="footer-brand-text">
          <p>Department of Physics<br />Indian Institute of Technology Kharagpur<br />Kharagpur - 721302, India</p>
          <p class="footer-contact"><span class="footer-contact-label">Phone:</span><span class="footer-contact-lines"><span class="footer-contact-line"><a href="tel:+913222281285">+91-3222-281285</a> (Office)</span><span class="footer-contact-line"><a href="tel:+913222282286">+91-3222-282286</a> (Head)</span></span></p>
          <p class="footer-contact"><span class="footer-contact-label">Email:</span><span class="footer-contact-lines"><span class="footer-contact-line"><a href="mailto:phyoffice@phy.iitkgp.ac.in">phyoffice@phy.iitkgp.ac.in</a> (Office)</span><span class="footer-contact-line"><a href="mailto:hod@phy.iitkgp.ac.in">hod@phy.iitkgp.ac.in</a> (Head)</span></span></p>
        </div>
      </section>

      <section class="quick-links">
        <h4>Quick Links</h4>
        <ul>
          <li class="icon-calendar"><a href="#">Academic Calendar</a></li>
          <li class="icon-book"><a href="./research.html">Course Catalogue</a></li>
          <li class="icon-cap"><a href="./programs.html">Admissions</a></li>
          <li class="icon-directory"><a href="./directory.html">Directory</a></li>
          <li class="icon-doc"><a href="./news-events.html">Forms &amp; Notices</a></li>
          <li class="icon-mail"><a href="./contact.html">Contact Us</a></li>
          <li class="icon-doc"><a href="https://erp.iitkgp.ac.in/" target="_blank" rel="noopener noreferrer">ERP</a></li>
          <li class="icon-mail"><a href="https://webmail.iitkgp.ac.in/" target="_blank" rel="noopener noreferrer">Webmail</a></li>
          <li class="icon-directory"><a href="https://www.iitkgp.ac.in/" target="_blank" rel="noopener noreferrer">IIT Kharagpur</a></li>

        </ul>
      </section>

      <section>
        <h4>Quick Navigation</h4>
        <ul>
          <li><a href="./about.html">About the Department</a></li>
          <li><a href="./programs.html">Academic Programs</a></li>
          <li><a href="./research.html">Research Areas</a></li>
          <li><a href="./faculty.html">Faculty &amp; Staff</a></li>
          <li><a href="https://www.iitkgp.ac.in" target="_blank" rel="noopener noreferrer">IIT Kharagpur Main Site</a></li>
        </ul>
      </section>
    </div>

    <div class="container footer-bottom">
      <p>&copy; 2026 Department of Physics, IIT Kharagpur. All rights reserved.</p>
      <div class="legal-links">
        <a href="#">Privacy Policy</a>
        <a href="./sitemap-page.html">Sitemap</a>
      </div>
    </div>
  </footer>

  <script>
    (async function () {
      try {
        var response = await fetch(window.location.origin + "/api/public/site-content", { cache: "no-store" });
        var data = await response.json();
        var pages = Array.isArray(data.pages) ? data.pages : [];
        var route = "/" + window.location.pathname.split("/").pop();
        var page = pages.find(function (item) { return String(item.route || "").toLowerCase() === route.toLowerCase(); }) || null;
        var sections = page && Array.isArray(page.sections) ? page.sections : [];
        var media = page && Array.isArray(page.media) ? page.media : [];
        var section = sections.find(function (item) { return item && item.id === "${safeSectionId}"; }) || sections[0] || null;
        var title = document.getElementById("${safeSectionId}-title");
        var content = document.getElementById("${safeSectionId}-content");
        var heroWrap = document.getElementById("${safeHeroId}-wrap");
        var heroImage = document.getElementById("${safeHeroId}");
        var leftImage = document.getElementById("${safeLeftId}");
        var rightImage = document.getElementById("${safeRightId}");
        var mediaById = media.reduce(function (result, item) {
          if (item && item.id) { result[item.id] = item; }
          return result;
        }, {});
        if (section && section.title && title) { title.textContent = section.title; }
        if (content) {
          var resolvedContent = (section && section.content ? section.content : "") || (page && page.summary ? page.summary : "");
          if (resolvedContent) { content.textContent = resolvedContent; content.style.whiteSpace = "pre-line"; }
        }
        if (mediaById["${safeHeroId}"] && mediaById["${safeHeroId}"].src && heroImage) {
          heroImage.src = mediaById["${safeHeroId}"].src;
          heroImage.alt = mediaById["${safeHeroId}"].alt || heroImage.alt;
          if (heroWrap) { heroWrap.style.display = "block"; }
        }
        if (mediaById["${safeLeftId}"] && mediaById["${safeLeftId}"].src && leftImage) {
          leftImage.src = mediaById["${safeLeftId}"].src;
          leftImage.alt = mediaById["${safeLeftId}"].alt || leftImage.alt;
          leftImage.style.display = "block";
        }
        if (mediaById["${safeRightId}"] && mediaById["${safeRightId}"].src && rightImage) {
          rightImage.src = mediaById["${safeRightId}"].src;
          rightImage.alt = mediaById["${safeRightId}"].alt || rightImage.alt;
          rightImage.style.display = "block";
        }
      } catch (error) {
        console.error("Failed to load page content.", error);
      }
    })();
  </script>
</body>
</html>`;
}

function isPublicWebsiteHtml(fileName) {
  const name = String(fileName || "").trim().toLowerCase();
  if (!name.endsWith(".html")) {
    return false;
  }
  if (
    name.startsWith("admin-")
    || name.startsWith("superadmin-")
    || name === "admin-login.html"
  ) {
    return false;
  }
  return true;
}

function extractFirstTextBlocksFromHtml(html, maxBlocks = 3) {
  const source = String(html || "");
  const mainMatch = source.match(/<main[\s\S]*?<\/main>/i);
  const scope = mainMatch ? mainMatch[0] : source;
  const blocks = [];
  const regex = /<(p|li|h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(scope)) && blocks.length < maxBlocks) {
    const text = String(match[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, "\"")
      .replace(/\s+/g, " ")
      .trim();
    if (text && text.length > 20) {
      blocks.push(text);
    }
  }
  return blocks;
}

function extractFullTextFromHtml(html) {
  const source = String(html || "");
  const mainMatch = source.match(/<main[\s\S]*?<\/main>/i);
  const scope = mainMatch ? mainMatch[0] : source;
  const regex = /<(p|li|h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks = [];
  let match;
  while ((match = regex.exec(scope))) {
    const text = String(match[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, "\"")
      .replace(/\s+/g, " ")
      .trim();
    if (text && text.length > 20) {
      blocks.push(text);
    }
  }
  return blocks.join("\n\n").trim();
}

function looksLikePlaceholderText(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return true;
  }
  const genericPhrases = [
    "managed content summary",
    "updates pending review",
    "content details",
    "overview content",
    "page content",
    "key contact and access information",
    "role details"
  ];
  if (text.length < 80) {
    return true;
  }
  return genericPhrases.some((phrase) => text.includes(phrase));
}

function shouldHydrateManagedPage(page) {
  if (!page || !Array.isArray(page.sections) || !page.sections.length) {
    return true;
  }
  const sectionContents = page.sections.map((item) => String((item && item.content) || "").trim());
  const hasContent = sectionContents.some((text) => text.length > 0 && !looksLikePlaceholderText(text));
  if (!hasContent) {
    return true;
  }
  return false;
}

function ensureGeneratedPageMediaSlots(page) {
  if (!page || !page.id || !Array.isArray(page.sections) || !page.sections.length) {
    return page;
  }
  if (Array.isArray(page.media) && page.media.length) {
    return page;
  }
  const sectionId = String((page.sections[0] && page.sections[0].id) || "").trim();
  if (!sectionId) {
    return page;
  }
  if (!/\-overview$/i.test(sectionId)) {
    return page;
  }
  return {
    ...page,
    media: [
      { id: `${sectionId}-hero-image`, label: "Hero Banner", src: "", alt: `${page.title || "Page"} hero banner` },
      { id: `${sectionId}-left-image`, label: "Left Content Image", src: "", alt: `${page.title || "Page"} left content image` },
      { id: `${sectionId}-right-image`, label: "Right Content Image", src: "", alt: `${page.title || "Page"} right content image` }
    ]
  };
}

async function hydrateManagedPageFromHtml(page) {
  if (!page || !page.route) {
    return page;
  }
  const route = String(page.route || "").trim();
  if (!route.endsWith(".html")) {
    return page;
  }
  const fileName = route.replace(/^\//, "");
  const fullPath = path.join(FRONTEND_DIR, fileName);
  let html = "";
  try {
    html = await fsp.readFile(fullPath, "utf8");
  } catch (error) {
    return page;
  }
  const fullText = extractFullTextFromHtml(html);
  if (!fullText) {
    return page;
  }

  const updated = deepClone(page);
  if (!Array.isArray(updated.sections) || !updated.sections.length) {
    const slug = toManagedPageSlug(fileName);
    updated.sections = [{
      id: `${slug || "page"}-overview`,
      title: `${updated.title || "Page"} Overview`,
      subtitle: "Editable content",
      content: fullText,
      image: ""
    }];
  } else {
    updated.sections = updated.sections.map((section) => {
      if (!section.content || looksLikePlaceholderText(section.content)) {
        return { ...section, content: fullText };
      }
      return section;
    });
  }
  if (looksLikePlaceholderText(updated.summary)) {
    updated.summary = fullText.slice(0, 180);
  }
  if (looksLikePlaceholderText(updated.draft)) {
    updated.draft = fullText;
  }
  return updated;
}

async function discoverManagedPagesFromFrontend() {
  const items = await fsp.readdir(FRONTEND_DIR, { withFileTypes: true });
  const files = items.filter((item) => item.isFile() && isPublicWebsiteHtml(item.name)).map((item) => item.name);
  const pages = [];

  for (const fileName of files) {
    const absolute = path.join(FRONTEND_DIR, fileName);
    const html = await fsp.readFile(absolute, "utf8");
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = String((titleMatch && titleMatch[1]) || fileName.replace(/\.html$/i, ""))
      .replace(/\s*\|[\s\S]*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const route = `/${fileName}`;
    const pageId = mapRouteToManagedPageId(route);
    const slug = toManagedPageSlug(fileName);
    const overviewId = `${slug || "page"}-overview`;
    const textBlocks = extractFirstTextBlocksFromHtml(html, 3);
    const overviewContent = textBlocks.join("\n\n").trim() || `${title} page content.`;

    pages.push({
      id: pageId,
      route,
      title: title || "Public Page",
      status: "published",
      summary: overviewContent.slice(0, 180),
      draft: overviewContent,
      sections: [
        {
          id: overviewId,
          title: `${title || "Page"} Overview`,
          subtitle: "Editable content",
          content: overviewContent,
          image: ""
        }
      ],
      media: [],
      peopleGroups: []
    });
  }

  return pages.sort((a, b) => String(a.route || "").localeCompare(String(b.route || "")));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeCredential(value) {
  return String(value || "").trim().toLowerCase();
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createTokenRecord(token) {
  return {
    value: token,
    createdAt: nowIso()
  };
}

function getRemoteIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function isRateLimited(key, maxAttempts, windowMs) {
  const now = Date.now();
  if (!loginAttempts.has(key)) {
    return false;
  }
  const attempts = loginAttempts.get(key);
  const recentAttempts = attempts.filter((time) => now - time < windowMs);
  loginAttempts.set(key, recentAttempts);
  return recentAttempts.length >= maxAttempts;
}

function recordAttempt(key) {
  const now = Date.now();
  if (!loginAttempts.has(key)) {
    loginAttempts.set(key, []);
  }
  loginAttempts.get(key).push(now);
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function validateInput(value, { required = false, minLength = 0, maxLength = Infinity, pattern = null } = {}) {
  const str = String(value || "").trim();
  if (required && !str) return false;
  if (str.length < minLength || str.length > maxLength) return false;
  if (pattern && !pattern.test(str)) return false;
  return true;
}

function hashInvitationToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function addHours(isoValue, hours) {
  return new Date(new Date(isoValue).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function verifyPassword(password, user) {
  const storedHash = String((user && user.passwordHash) || "");
  if (!storedHash) {
    return false;
  }
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    try {
      return bcrypt.compareSync(String(password), storedHash);
    } catch (error) {
      return false;
    }
  }
  const hashed = hashPassword(password, user.salt);
  const a = Buffer.from(hashed, "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeManagedUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }
  if (!Array.isArray(user.tokens)) {
    user.tokens = [];
  } else {
    user.tokens = user.tokens.map(token => {
      if (typeof token === "string") {
        return { value: token, createdAt: nowIso() };
      }
      return token;
    });
  }
  user.permissions = Array.isArray(user.permissions) ? user.permissions : [];
  user.invitationStatus = String(user.invitationStatus || ((user.role === "admin" && user.status === "pending") ? "pending" : "active")).trim().toLowerCase();
  const invitation = user.invitation && typeof user.invitation === "object" ? user.invitation : {};
  user.invitation = {
    tokenHash: String(invitation.tokenHash || ""),
    invitedAt: String(invitation.invitedAt || user.createdAt || ""),
    expiresAt: String(invitation.expiresAt || ""),
    lastSentAt: String(invitation.lastSentAt || invitation.invitedAt || user.createdAt || ""),
    usedAt: String(invitation.usedAt || "")
  };
  user.resetPasswordToken = String(user.resetPasswordToken || "");
  user.resetPasswordExpires = String(user.resetPasswordExpires || "");
  user.resetPasswordUsedAt = String(user.resetPasswordUsedAt || "");
  user.lastLoginAt = String(user.lastLoginAt || "");
  return user;
}

function isPendingAdminInvitation(user) {
  return user && user.role === "admin" && user.invitationStatus === "pending";
}

function getInvitationState(user) {
  const account = normalizeManagedUser(user);
  if (!account || !account.invitation || !account.invitation.tokenHash) {
    return { valid: false, message: "This invitation link is invalid or has already been used." };
  }
  if (account.invitationStatus !== "pending") {
    return { valid: false, message: "This invitation is no longer pending." };
  }
  if (!account.invitation.expiresAt || new Date(account.invitation.expiresAt).getTime() <= Date.now()) {
    return { valid: false, message: "This invitation link has expired." };
  }
  return { valid: true };
}

function findUserByInvitationToken(users, token) {
  const tokenHash = hashInvitationToken(token);
  return users.find((user) => {
    const account = normalizeManagedUser(user);
    return account.invitation && account.invitation.tokenHash === tokenHash;
  }) || null;
}

function findUserByResetPasswordToken(users, token) {
  const tokenHash = hashInvitationToken(token);
  return users.find((user) => {
    const account = normalizeManagedUser(user);
    return account.resetPasswordToken === tokenHash;
  }) || null;
}

function getResetPasswordState(user) {
  const account = normalizeManagedUser(user);
  if (!account || !account.resetPasswordToken) {
    return { valid: false, message: "This password reset link is invalid or has already been used." };
  }
  if (!account.resetPasswordExpires || new Date(account.resetPasswordExpires).getTime() <= Date.now()) {
    return { valid: false, message: "This password reset link has expired." };
  }
  return { valid: true };
}

function clearResetPasswordState(user) {
  user.resetPasswordToken = "";
  user.resetPasswordExpires = "";
  user.resetPasswordUsedAt = nowIso();
}

function getAppBaseUrl(req) {
  if (APP_BASE_URL) {
    return APP_BASE_URL.replace(/\/+$/, "");
  }
  return `http://${req.headers.host}`;
}

function getMailTransporter() {
  if (mailTransporter) {
    return mailTransporter;
  }
  if (SMTP_HOST) {
    const config = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      tls: {
        rejectUnauthorized: false
      }
    };

    if (SMTP_USER && SMTP_PASS) {
      config.auth = {
        user: SMTP_USER,
        pass: SMTP_PASS
      };
    }

    mailTransporter = nodemailer.createTransport(config);
    return mailTransporter;
  }
  mailTransporter = nodemailer.createTransport({ jsonTransport: true });
  return mailTransporter;
}

async function sendAdminInvitationEmail(req, siteSettings, user, rawToken) {
  const transporter = getMailTransporter();
  const setupLink = `${getAppBaseUrl(req)}/admin-setup-password.html?token=${encodeURIComponent(rawToken)}`;
  const fromAddress = SMTP_FROM || String(siteSettings.systemEmail || "").trim() || "no-reply@phy.iitkgp.ac.in";
  const mail = {
    from: fromAddress,
    to: user.email,
    subject: "Set up your IIT Portal Admin account",
    text: [
      `Hello ${user.name},`,
      "",
      "You have been invited to create your Admin account for the IIT Portal.",
      `Set your password here: ${setupLink}`,
      "",
      "This invitation link expires in 24 hours and can only be used once."
    ].join("\n")
  };
  let info;
  try {
    info = await transporter.sendMail(mail);
  } catch (error) {
    const message = String(error && error.message ? error.message : "").trim();
    if (
      message.includes("535-5.7.8") ||
      message.includes("BadCredentials") ||
      message.includes("Username and Password not accepted")
    ) {
      throw new Error("SMTP authentication failed. Check the configured email username and app password.");
    }
    if (IS_PRODUCTION) {
      console.error("Invitation email error:", message);
      throw new Error("Unable to send the invitation email right now.");
    }
    throw new Error(message ? `Unable to send the invitation email: ${message}` : "Unable to send the invitation email right now.");
  }
  return setupLink;
}

async function sendPasswordResetEmail(req, siteSettings, user, rawToken) {
  const transporter = getMailTransporter();
  const resetLink = `${getAppBaseUrl(req)}/reset-password.html?token=${encodeURIComponent(rawToken)}`;
  const fromAddress = SMTP_FROM || String(siteSettings.systemEmail || "").trim() || "no-reply@phy.iitkgp.ac.in";
  const mail = {
    from: fromAddress,
    to: user.email,
    subject: "Reset your IIT Portal password",
    text: [
      `Hello ${user.name},`,
      "",
      "We received a request to reset your IIT Portal password.",
      `Reset your password here: ${resetLink}`,
      "",
      "This reset link expires in 1 hour and can only be used once.",
      "If you did not request a password reset, you can ignore this email."
    ].join("\n")
  };
  let info;
  try {
    info = await transporter.sendMail(mail);
  } catch (error) {
    const message = String(error && error.message ? error.message : "").trim();
    if (
      message.includes("535-5.7.8") ||
      message.includes("BadCredentials") ||
      message.includes("Username and Password not accepted")
    ) {
      throw new Error("SMTP authentication failed. Check the configured email username and app password.");
    }
    if (IS_PRODUCTION) {
      console.error("Password reset email error:", message);
      throw new Error("Unable to send the password reset email right now.");
    }
    throw new Error(message ? `Unable to send the password reset email: ${message}` : "Unable to send the password reset email right now.");
  }
  return resetLink;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getHpcAdminRecipients(siteStore) {
  const recipients = new Set();

  try {
    const usersStore = await readUsers();
    for (const user of (usersStore.users || [])) {
      if (user.status !== "inactive" && user.status !== "suspended") {
        if (user.role === "superadmin" || hasPermission(user, "hpc_facility", siteStore)) {
          const email = normalizeEmail(user.email);
          if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            recipients.add(email);
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to retrieve HPC admin users:", err);
  }

  const defaultHpcAdmin = "itadmin@phy.iitkgp.ac.in";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(defaultHpcAdmin)) {
    recipients.add(defaultHpcAdmin);
  }

  const systemEmail = normalizeEmail(siteStore && siteStore.settings && siteStore.settings.systemEmail);
  if (systemEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(systemEmail)) {
    recipients.add(systemEmail);
  }

  return Array.from(recipients);
}

async function sendHpcRequestNotificationEmail(req, siteStore, request) {
  if (siteStore && siteStore.settings && siteStore.settings.emailNotifications === false) {
    console.log("Email notifications disabled in settings. Skipping HPC email notification.");
    return false;
  }

  const recipients = await getHpcAdminRecipients(siteStore);
  if (!recipients.length) {
    console.warn("No recipients found for HPC request notification.");
    return false;
  }

  const transporter = getMailTransporter();
  const fromAddress = SMTP_FROM || String((siteStore && siteStore.settings && siteStore.settings.systemEmail) || "").trim() || "itadmin@phy.iitkgp.ac.in";
  const adminPortalUrl = `${getAppBaseUrl(req)}/admin-module.html?module=computational-access&title=HPC%20Facility`;

  const formattedDate = request.createdAt
    ? new Date(request.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : nowIso();

  const textBody = [
    "Dear HPC Administrator,",
    "",
    "A new HPC account request has been submitted through the Department of Physics portal.",
    "",
    "--------------------------------------------------",
    "HPC ACCOUNT REQUEST DETAILS",
    "--------------------------------------------------",
    `Request ID: ${request.id || "N/A"}`,
    `Submitted At: ${formattedDate}`,
    "",
    "APPLICANT INFORMATION:",
    `  Name: ${request.name || "N/A"}`,
    `  Department: ${request.department || "N/A"}`,
    `  Preferred Login ID: ${request.preferredLoginId || "N/A"}`,
    `  Institute ID / Roll No: ${request.instituteId || "N/A"}`,
    `  Email Address: ${request.email || "N/A"}`,
    `  Mobile No.: ${request.mobile || "N/A"}`,
    `  Supervisor Name: ${request.supervisorName || "N/A"}`,
    "",
    "RESOURCE REQUIREMENTS:",
    `  Software Type: ${request.softwareType || "N/A"}`,
    `  Software Name: ${request.softwareName || "N/A"}`,
    `  Mode: ${request.mode || request.softwareLibraries || "N/A"}`,
    "",
    "SIGNATURES & DATES:",
    `  Applicant Signature: ${request.applicantSignature && request.applicantSignature.startsWith("data:image/") ? "[Uploaded Signature Image]" : (request.applicantSignature || "N/A")}`,
    `  Submission Date: ${request.date || "N/A"}`,
    `  Supervisor Signature: ${request.supervisorSignature && request.supervisorSignature.startsWith("data:image/") ? "[Uploaded Signature Image]" : (request.supervisorSignature || "N/A")}`,
    `  In-Charge Signature: ${request.inChargeSignature || "N/A"}`,
    "",
    "OFFICE USE (if filled):",
    `  Server Allotted: ${request.serverAllotted || "N/A"}`,
    `  Login ID Given: ${request.loginIdGiven || "N/A"}`,
    "",
    "--------------------------------------------------",
    "View & review this request in the Department Admin Portal:",
    adminPortalUrl,
    "",
    "This is an automated notification from the IIT Kharagpur Department of Physics Portal."
  ].join("\n");

  const row = (label, val) => {
    const str = String(val || "").trim();
    let displayVal = escapeHtml(str || "—");
    if (str.startsWith("data:image/") || str.startsWith("./uploads/") || str.startsWith("/uploads/")) {
      displayVal = `<img src="${escapeHtml(str)}" alt="Signature" style="max-height: 48px; max-width: 220px; vertical-align: middle; border-bottom: 1px solid #94a3b8;" />`;
    }
    return `
    <tr>
      <td style="padding: 8px 12px; font-weight: 600; color: #1e293b; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; width: 35%;">${escapeHtml(label)}</td>
      <td style="padding: 8px 12px; color: #334155; border-bottom: 1px solid #e2e8f0;">${displayVal}</td>
    </tr>`;
  };

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New HPC Account Request</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px;">
  <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
    <div style="background-color: #003366; color: #ffffff; padding: 20px 24px;">
      <h2 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">Departmental Computing Facility (HPC)</h2>
      <p style="margin: 0; font-size: 13px; color: #93c5fd;">Department of Physics | Indian Institute of Technology Kharagpur</p>
    </div>
    <div style="padding: 24px;">
      <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; margin-bottom: 20px; border-radius: 0 4px 4px 0;">
        <p style="margin: 0; color: #1e40af; font-size: 14px; font-weight: 500;">
          A new HPC account request has been submitted by <strong>${escapeHtml(request.name || "a user")}</strong> and is awaiting administrative review.
        </p>
      </div>

      <h3 style="font-size: 15px; color: #0f172a; margin: 0 0 8px 0; border-bottom: 2px solid #003366; padding-bottom: 4px;">Applicant Details</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
        ${row("Applicant Name", request.name)}
        ${row("Department", request.department)}
        ${row("Preferred Login ID", request.preferredLoginId)}
        ${row("Institute ID / Roll No", request.instituteId)}
        ${row("Email Address", request.email)}
        ${row("Mobile Number", request.mobile)}
        ${row("Supervisor Name", request.supervisorName)}
      </table>

      <h3 style="font-size: 15px; color: #0f172a; margin: 0 0 8px 0; border-bottom: 2px solid #003366; padding-bottom: 4px;">Resource Requirements</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
        ${row("Software Type", request.softwareType)}
        ${row("Software Name", request.softwareName)}
        ${row("Mode", request.mode || request.softwareLibraries)}
      </table>

      <h3 style="font-size: 15px; color: #0f172a; margin: 0 0 8px 0; border-bottom: 2px solid #003366; padding-bottom: 4px;">Submission &amp; Signatures</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
        ${row("Applicant Signature", request.applicantSignature)}
        ${row("Date", request.date)}
        ${row("Supervisor Signature", request.supervisorSignature)}
        ${row("In-Charge Signature", request.inChargeSignature)}
        ${request.serverAllotted ? row("Server Allotted", request.serverAllotted) : ""}
        ${request.loginIdGiven ? row("Login ID Given", request.loginIdGiven) : ""}
        ${row("Request ID", request.id)}
        ${row("Submission Time", formattedDate)}
      </table>

      <div style="text-align: center; margin: 28px 0 16px 0;">
        <a href="${adminPortalUrl}" style="display: inline-block; background-color: #003366; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0, 51, 102, 0.2);">Review in Admin Portal</a>
      </div>
    </div>
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 12px; color: #64748b; text-align: center;">
      <p style="margin: 0 0 4px 0;">This email was sent automatically by the IIT Kharagpur Department of Physics Portal.</p>
      <p style="margin: 0;">Department of Physics, Indian Institute of Technology Kharagpur, WB 721302, India</p>
    </div>
  </div>
</body>
</html>`;

  const mailOptions = {
    from: `"IIT KGP Physics HPC Facility" <${fromAddress}>`,
    to: recipients.join(", "),
    subject: `[HPC Facility] New Account Request: ${request.name || request.preferredLoginId || request.id}`,
    text: textBody,
    html: htmlBody
  };

  if (request.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)) {
    mailOptions.replyTo = `"${request.name || "Applicant"}" <${request.email}>`;
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("HPC admin notification email dispatched successfully:", info && (info.messageId || info.response || "ok"));
    return true;
  } catch (error) {
    console.error("Failed to send HPC notification email:", error && error.message ? error.message : error);
    return false;
  }
}

function getAllowedOrigin(originHeader) {
  const origin = String(originHeader || "").trim();
  if (!origin) {
    return "null";
  }
  const configuredOrigins = [FRONTEND_URL].filter(Boolean).concat(
    CORS_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)
  );
  if (!configuredOrigins.length) {
    return "null";
  }
  return configuredOrigins.includes(origin) ? origin : "null";
}

function getCorsHeaders(originHeader) {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(originHeader),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  };
}

function getSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-XSS-Protection": "1; mode=block",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com https://www.google.com https://maps.google.com https://*.google.com; object-src 'none'; base-uri 'self';",
    "X-Powered-By": ""
  };
}

function getAuthCacheHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache"
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const reqUrl = res.req ? (res.req.url || "") : "";
  const isAuthRoute = reqUrl.startsWith("/api/auth/");
  const cacheHeaders = isAuthRoute ? getAuthCacheHeaders() : {};
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...cacheHeaders,
    ...extraHeaders,
    ...getCorsHeaders(res.req && res.req.headers ? res.req.headers.origin : ""),
    ...getSecurityHeaders()
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8", ...getSecurityHeaders() });
  res.end(html);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", ...getSecurityHeaders() });
  res.end(text);
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createPublicUser(user) {
  const account = normalizeManagedUser(user);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role || "faculty",
    status: account.status || "active",
    loginId: account.loginId || "",
    facultyId: account.facultyId || "",
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
    invitationStatus: account.invitationStatus || "active",
    invitedAt: account.invitation ? account.invitation.invitedAt : "",
    lastLoginAt: account.lastLoginAt || ""
  };
}

function formatPortalDate(isoValue) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(isoValue || Date.now()));
}

function formatRelativeTime(isoValue) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoValue).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} sec ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

function getMaintenanceHtml(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Maintenance Mode</title>
  <style>
    body{margin:0;font-family:Inter,Arial,sans-serif;background:#0f1730;color:#fff;display:grid;place-items:center;min-height:100vh}
    .card{width:min(90vw,640px);padding:42px 36px;border-radius:24px;background:linear-gradient(135deg,#1e2f77 0%,#5f38e6 100%);box-shadow:0 30px 60px rgba(0,0,0,.28)}
    h1{margin:0 0 14px;font-size:38px;line-height:1.1}
    p{margin:0;font-size:17px;line-height:1.7;color:rgba(255,255,255,.82)}
  </style>
</head>
<body>
  <section class="card">
    <h1>Website Under Maintenance</h1>
    <p>${message}</p>
  </section>
</body>
</html>`;
}

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  const defaults = [
    { file: USERS_FILE, fallback: { users: [] } },
    { file: FACULTY_FILE, fallback: { faculty: [] } },
    { file: PORTAL_FILE, fallback: { notices: [], blockedDates: [], blockedSlots: [], seminarRequests: [], zoomBookings: [], facilityBookings: [], hpcAccountRequests: [], tickets: [], notifications: [], supportConversations: [] } },
    { file: SITE_FILE, fallback: { settings: { maintenanceMode: false, maintenanceMessage: "", rolePermissions: {}, siteTitle: "", metaDescription: "", systemEmail: "", emailNotifications: true, lastBackupAt: "" }, content: { homepage: {}, pages: [] } } },
    { file: VISITORS_FILE, fallback: { count: 0 } }
  ];

  for (const item of defaults) {
    try {
      await fsp.access(item.file, fs.constants.F_OK);
    } catch (error) {
      await fsp.writeFile(item.file, JSON.stringify(item.fallback, null, 2));
    }
  }

  const superadminBookingsFile = path.join(FRONTEND_DIR, "superadmin-bookings.html");
  try {
    let content = await fsp.readFile(superadminBookingsFile, "utf8");
    if (content.includes("day === 0 || day === 6")) {
      content = content.replace("return day === 0 || day === 6;", "return false;");
      content = content.replace("Weekends are blocked automatically.", "");
      content = content.replace("Weekends are marked automatically.", "");
      content = content.replace("isWeekend(dateId) || ", "");
      content = content.replace(/isWeekend\(item\.date\)\s*\|\|\s*/g, "");
      await fsp.writeFile(superadminBookingsFile, content, "utf8");
    }
  } catch (_e) {}
}

async function readJson(file, fallback) {
  await ensureStorage();
  const raw = await fsp.readFile(file, "utf8");
  const parsed = JSON.parse(raw || "{}");
  return parsed && typeof parsed === "object" ? parsed : deepClone(fallback);
}

async function writeJson(file, payload) {
  await ensureStorage();
  await fsp.writeFile(file, JSON.stringify(payload, null, 2));
}

async function readVisitorCount() {
  if (visitorCountCache !== null) return visitorCountCache;
  try {
    const raw = await fsp.readFile(VISITORS_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    visitorCountCache = typeof parsed.count === "number" ? parsed.count : 0;
  } catch (_e) {
    visitorCountCache = 0;
  }
  return visitorCountCache;
}

async function incrementVisitorCount() {
  const current = await readVisitorCount();
  visitorCountCache = current + 1;
  await fsp.writeFile(VISITORS_FILE, JSON.stringify({ count: visitorCountCache }, null, 2));
  return visitorCountCache;
}

async function readUsers() {
  const data = await readJson(USERS_FILE, { users: [] });
  return { users: Array.isArray(data.users) ? data.users.map((item) => normalizeManagedUser(item)) : [] };
}

async function writeUsers(payload) {
  await writeJson(USERS_FILE, payload);
}

async function readFacultyStore() {
  const data = await readJson(FACULTY_FILE, { faculty: [] });
  return { faculty: normalizeFacultyEntries(Array.isArray(data.faculty) ? data.faculty : []) };
}

async function writeFacultyStore(payload) {
  await writeJson(FACULTY_FILE, {
    faculty: normalizeFacultyEntries(payload && payload.faculty)
  });
}

async function readPortalStore() {
  const data = await readJson(PORTAL_FILE, {
    notices: [],
    blockedDates: [],
    blockedSlots: [],
    seminarRequests: [],
    zoomBookings: [],
    facilityBookings: [],
    tickets: [],
    notifications: [],
    supportConversations: [],
    bookingResources: {
      seminarHalls: ["Seminar Hall 1", "Seminar Hall 2"],
      roomNumbers: ["Room 101", "Room 102", "Room 201", "Room 202"],
      facilityNames: ["Hall 1", "Hall 2", "Hall 3", "Hall 4", "Hall 5"]
    }
  });
  const bookingResources = {
    seminarHalls: Array.isArray(data.bookingResources && data.bookingResources.seminarHalls)
      ? data.bookingResources.seminarHalls.map((item) => String(item || "").trim()).filter(Boolean)
      : ["Seminar Hall 1", "Seminar Hall 2"],
    roomNumbers: Array.isArray(data.bookingResources && data.bookingResources.roomNumbers)
      ? data.bookingResources.roomNumbers.map((item) => String(item || "").trim()).filter(Boolean)
      : ["Room 101", "Room 102", "Room 201", "Room 202"],
    facilityNames: Array.isArray(data.bookingResources && data.bookingResources.facilityNames)
      ? data.bookingResources.facilityNames.map((item) => String(item || "").trim()).filter(Boolean)
      : (Array.isArray(data.bookingResources && data.bookingResources.seminarHalls)
        ? data.bookingResources.seminarHalls.map((item) => String(item || "").trim()).filter(Boolean)
        : ["Hall 1", "Hall 2", "Hall 3", "Hall 4", "Hall 5"])
  };
  const facilityNames = bookingResources.facilityNames.map((item) => item.toLowerCase());
  const legacyFacilityBookings = (Array.isArray(data.seminarRequests) ? data.seminarRequests : []).filter((item) =>
    facilityNames.includes(String(item && item.roomName || "").trim().toLowerCase())
  );
  const legacyFacilityIds = new Set(legacyFacilityBookings.map((item) => item.id));
  const storedFacilityBookings = Array.isArray(data.facilityBookings) ? data.facilityBookings : [];

  return {
    notices: Array.isArray(data.notices) ? data.notices : [],
    blockedDates: Array.isArray(data.blockedDates) ? data.blockedDates : [],
    blockedSlots: Array.isArray(data.blockedSlots) ? data.blockedSlots : [],
    seminarRequests: (Array.isArray(data.seminarRequests) ? data.seminarRequests : []).filter((item) => !legacyFacilityIds.has(item.id)),
    zoomBookings: Array.isArray(data.zoomBookings) ? data.zoomBookings : [],
    facilityBookings: storedFacilityBookings.concat(legacyFacilityBookings.filter((item) => !storedFacilityBookings.some((stored) => stored.id === item.id))),
    hpcAccountRequests: Array.isArray(data.hpcAccountRequests) ? data.hpcAccountRequests : [],
    tickets: Array.isArray(data.tickets) ? data.tickets : [],
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    supportConversations: Array.isArray(data.supportConversations) ? data.supportConversations.map((item, index) => ({
      id: String((item && item.id) || createId(`support-${index + 1}`)).trim(),
      adminEmail: normalizeEmail(item && item.adminEmail),
      adminName: String((item && item.adminName) || "").trim(),
      adminLoginId: String((item && item.adminLoginId) || "").trim(),
      adminFacultyId: String((item && item.adminFacultyId) || "").trim(),
      updatedAt: String((item && item.updatedAt) || nowIso()).trim(),
      messages: Array.isArray(item && item.messages) ? item.messages.map((message) => ({
        id: String((message && message.id) || createId("support-message")).trim(),
        senderRole: String((message && message.senderRole) || "admin").trim(),
        senderEmail: normalizeEmail(message && message.senderEmail),
        senderName: String((message && message.senderName) || "").trim(),
        text: String((message && message.text) || "").trim(),
        imageDataUrl: String((message && message.imageDataUrl) || "").trim(),
        createdAt: String((message && message.createdAt) || nowIso()).trim()
      })) : []
    })) : [],
    bookingResources
  };
}

function sanitizeSupportImageDataUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error("Unsupported image format. Use PNG/JPG/WEBP/GIF.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Attached image is empty.");
  }
  if (buffer.length > 4 * 1024 * 1024) {
    throw new Error("Attached image must be 4 MB or smaller.");
  }
  return raw;
}

function findOrCreateSupportConversation(portalStore, adminUser) {
  const adminEmail = normalizeEmail(adminUser && adminUser.email);
  let conversation = portalStore.supportConversations.find((item) => normalizeEmail(item.adminEmail) === adminEmail);
  if (!conversation) {
    conversation = {
      id: createId("support"),
      adminEmail,
      adminName: String((adminUser && adminUser.name) || "").trim(),
      adminLoginId: String((adminUser && adminUser.loginId) || "").trim(),
      adminFacultyId: String((adminUser && adminUser.facultyId) || "").trim(),
      updatedAt: nowIso(),
      messages: []
    };
    portalStore.supportConversations.unshift(conversation);
  } else {
    conversation.adminName = String((adminUser && adminUser.name) || conversation.adminName || "").trim();
    conversation.adminLoginId = String((adminUser && adminUser.loginId) || conversation.adminLoginId || "").trim();
    conversation.adminFacultyId = String((adminUser && adminUser.facultyId) || conversation.adminFacultyId || "").trim();
  }
  return conversation;
}

function getAdminProfileDetailsFromStores(conversation, usersStore, facultyStore) {
  const adminEmail = normalizeEmail(conversation && conversation.adminEmail);
  const users = Array.isArray(usersStore && usersStore.users) ? usersStore.users : [];
  const facultyEntries = Array.isArray(facultyStore && facultyStore.faculty) ? facultyStore.faculty : [];
  const adminUser = users.find((item) => normalizeEmail(item.email) === adminEmail) || null;
  const profile = facultyEntries.find((item) =>
    normalizeEmail(item.email) === adminEmail
    || (adminUser && isSameFacultyProfile(item, adminUser))
  ) || null;
  return {
    name: String((conversation && conversation.adminName) || (adminUser && adminUser.name) || "").trim(),
    email: adminEmail,
    phone: String((profile && profile.phone) || "").trim(),
    designation: String((profile && profile.designation) || "").trim(),
    office: String((profile && profile.office) || "").trim(),
    loginId: String((conversation && conversation.adminLoginId) || (adminUser && adminUser.loginId) || "").trim(),
    facultyId: String((conversation && conversation.adminFacultyId) || (adminUser && adminUser.facultyId) || "").trim()
  };
}

function mapConversationSummary(conversation) {
  const messages = Array.isArray(conversation && conversation.messages) ? conversation.messages : [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  return {
    id: conversation.id,
    adminEmail: conversation.adminEmail,
    adminName: conversation.adminName,
    adminLoginId: conversation.adminLoginId,
    adminFacultyId: conversation.adminFacultyId,
    updatedAt: conversation.updatedAt,
    messagesCount: messages.length,
    lastMessage: lastMessage ? {
      text: lastMessage.text,
      hasImage: Boolean(lastMessage.imageDataUrl),
      createdAt: lastMessage.createdAt,
      senderName: lastMessage.senderName
    } : null
  };
}

async function writePortalStore(payload) {
  await writeJson(PORTAL_FILE, payload);
}

async function readSiteStore() {
  const data = await readJson(SITE_FILE, {
    settings: { maintenanceMode: false, maintenanceMessage: "", rolePermissions: {}, siteTitle: "", metaDescription: "", systemEmail: "", emailNotifications: true, lastBackupAt: "", superadminSignupKey: "" },
    content: { homepage: {}, pages: [] }
  });
  const defaultPages = getDefaultManagedPages();
  const discoveredPages = await discoverManagedPagesFromFrontend();
  const combinedDefaults = defaultPages.slice();
  discoveredPages.forEach((page) => {
    if (!combinedDefaults.find((item) => item.id === page.id)) {
      combinedDefaults.push(page);
    }
  });
  const storedPages = Array.isArray(data.content && data.content.pages) ? data.content.pages : [];
  let normalizedPages = combinedDefaults.map((defaultPage) => {
    const existing = storedPages.find((item) => item && item.id === defaultPage.id) || {};
    return {
      ...deepClone(defaultPage),
      ...existing,
      sections: Array.isArray(existing.sections) && existing.sections.length ? existing.sections : deepClone(defaultPage.sections || []),
      media: Array.isArray(existing.media) ? existing.media : deepClone(defaultPage.media || []),
      cards: Array.isArray(existing.cards) ? existing.cards : deepClone(defaultPage.cards || []),
      peopleGroups: defaultPage.peopleGroups || existing.peopleGroups
        ? normalizePeopleGroups(existing.peopleGroups, defaultPage.peopleGroups)
        : []
    };
  });
  storedPages.forEach((page) => {
    if (page && page.id && !normalizedPages.find((item) => item.id === page.id)) {
      normalizedPages.push(page);
    }
  });

  // Repair uploads made before headerless spreadsheets were supported. This
  // keeps their rows visible immediately, without requiring an admin to
  // delete and upload the same file again.
  normalizedPages = normalizedPages.map((page) => {
    const upload = page && page.id === "page-graduate-students" ? page.alumniUpload : null;
    const uploadPath = getUploadPathFromPublicPath(upload && upload.path);
    const extension = path.extname(String(upload && upload.path || "")).toLowerCase();
    if (!uploadPath || ![".xls", ".xlsx", ".csv"].includes(extension) || (Array.isArray(upload.parsedPeopleGroups) && upload.parsedPeopleGroups.length)) {
      return page;
    }
    try {
      const parsedPeopleGroups = buildAlumniPeopleGroupsFromRows(parseAlumniRowsFromUpload(fs.readFileSync(uploadPath), extension));
      if (!parsedPeopleGroups.length) {
        return page;
      }
      return {
        ...page,
        peopleGroups: normalizePeopleGroups(parsedPeopleGroups, page.peopleGroups),
        alumniUpload: { ...upload, parsedPeopleGroups }
      };
    } catch (error) {
      return page;
    }
  });

  const storedPageIds = new Set(
    storedPages
      .filter((sp) => sp && sp.id && Array.isArray(sp.sections) && sp.sections.length > 0)
      .map((sp) => sp.id)
  );

  normalizedPages = await Promise.all(
    normalizedPages.map(async (page) => {
      const pageWithMedia = ensureGeneratedPageMediaSlots(page);
      if (storedPageIds.has(page.id) || !shouldHydrateManagedPage(pageWithMedia)) {
        return pageWithMedia;
      }
      return hydrateManagedPageFromHtml(pageWithMedia);
    })
  );

  return {
    settings: {
      maintenanceMode: Boolean(data.settings && data.settings.maintenanceMode),
      maintenanceMessage: String((data.settings && data.settings.maintenanceMessage) || ""),
      rolePermissions: (data.settings && data.settings.rolePermissions) || {},
      siteTitle: String((data.settings && data.settings.siteTitle) || ""),
      metaDescription: String((data.settings && data.settings.metaDescription) || ""),
      systemEmail: String((data.settings && data.settings.systemEmail) || ""),
      emailNotifications: data.settings && Object.prototype.hasOwnProperty.call(data.settings, "emailNotifications") ? Boolean(data.settings.emailNotifications) : true,
      lastBackupAt: String((data.settings && data.settings.lastBackupAt) || ""),
      superadminSignupKey: String((data.settings && data.settings.superadminSignupKey) || "")
    },
    content: {
      homepage: (data.content && data.content.homepage) || {},
      pages: normalizedPages
    }
  };
}

async function writeSiteStore(payload) {
  await writeJson(SITE_FILE, payload);
}

function sanitizeString(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/javascript:/gi, "blocked-javascript:")
    .replace(/vbscript:/gi, "blocked-vbscript:")
    .replace(/onload\s*=/gi, "blocked-onload=")
    .replace(/onerror\s*=/gi, "blocked-onerror=")
    .replace(/onclick\s*=/gi, "blocked-onclick=")
    .replace(/onmouseover\s*=/gi, "blocked-onmouseover=")
    .replace(/onfocus\s*=/gi, "blocked-onfocus=");
}

function sanitizePayload(obj) {
  if (obj == null) return obj;
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizePayload);
  if (typeof obj === "object") {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("salt") ||
        lowerKey.includes("hash") ||
        lowerKey.includes("dataurl") ||
        lowerKey.includes("token")
      ) {
        sanitized[key] = obj[key];
      } else {
        sanitized[key] = sanitizePayload(obj[key]);
      }
    }
    return sanitized;
  }
  return obj;
}

function parseBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(sanitizePayload(parsed));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeUploadBasename(value) {
  return String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "image";
}

function getUploadPathFromPublicPath(publicPath) {
  const normalized = String(publicPath || "").replace(/\\/g, "/").trim();
  if (!normalized.startsWith("./uploads/")) {
    return "";
  }
  const fileName = path.basename(normalized);
  return path.join(UPLOADS_DIR, fileName);
}

function normalizeAlumniColumnName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getAlumniCell(row, names) {
  const normalizedNames = names.map(normalizeAlumniColumnName);
  const key = Object.keys(row || {}).find((item) => normalizedNames.includes(normalizeAlumniColumnName(item)));
  return key ? String(row[key] == null ? "" : row[key]).trim() : "";
}

function slugifyId(value, fallback) {
  return String(value || fallback || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || String(fallback || "item");
}

function buildAlumniPeopleGroupsFromRows(rows) {
  const people = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const name = getAlumniCell(row, ["name", "student name", "alumni name", "full name"]);
    const designation = getAlumniCell(row, ["designation", "area", "research area", "department", "specialization", "field"]);
    const topic = getAlumniCell(row, ["topic", "research topic", "title", "research title", "thesis topic"]);
    const supervisor = getAlumniCell(row, ["supervisor", "guide", "advisor", "mentor", "office", "office room"]);
    const email = getAlumniCell(row, ["email", "email id", "email address", "mail", "contact", "contact email"]);
    const category = getAlumniCell(row, ["category", "program", "course", "degree", "student type", "section"]) || "Alumni";
    const photo = getAlumniCell(row, ["photo", "photo url", "image", "image url"]);
    if (!name && !email && !designation && !topic && !supervisor) {
      return null;
    }
    return {
      id: `alumni-upload-${index + 1}-${slugifyId(name || email, "person")}`,
      name,
      designation,
      topic,
      office: supervisor,
      email,
      category,
      photo
    };
  }).filter(Boolean);

  const groupsByCategory = people.reduce((result, person) => {
    const category = person.category || "Alumni";
    if (!result[category]) {
      result[category] = [];
    }
    result[category].push(person);
    return result;
  }, {});

  return Object.keys(groupsByCategory).map((category) => ({
    id: `alumni-upload-${slugifyId(category, "group")}`,
    title: category,
    items: groupsByCategory[category]
  }));
}

function buildManagedPeopleRecordsFromRows(rows, type) {
  const safeType = type === "students" ? "students" : (type === "administration" ? "administration" : "postdocs");
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const name = getAlumniCell(row, ["name", "student name", "researcher name", "postdoc name", "staff name", "full name"]);
    const designation = getAlumniCell(row, ["designation", "research area", "area", "specialization", "field", "department", "topic", "research topic"]);
    const office = getAlumniCell(row, ["office", "office room", "room", "supervisor", "guide", "advisor", "mentor"]);
    const email = getAlumniCell(row, ["email", "email id", "email address", "mail"]);
    const contact = getAlumniCell(row, ["contact", "contact number", "contact no", "contactno", "contactnumber", "phone", "phone number", "phone no", "phoneno", "phonenumber", "mobile", "mobile number", "mobile no", "mobileno", "mobilenumber", "telephone", "cell"]);
    const group = getAlumniCell(row, ["group", "category", "section", "type", "program"]);
    if (!name && !designation && !office && !email && !contact) {
      return null;
    }
    return {
      id: `${safeType}-upload-${index + 1}-${slugifyId(name || email, "person")}`,
      name,
      designation,
      office,
      email,
      contact,
      topic: "",
      category: "",
      photo: "",
      group
    };
  }).filter(Boolean);
}

function buildManagedPeopleGroupsFromRows(rows, type) {
  const safeType = type === "students" ? "students" : (type === "administration" ? "administration" : "postdocs");
  const people = buildManagedPeopleRecordsFromRows(rows, safeType);

  if (safeType === "students") {
    return [
      {
        id: "students-current",
        title: "Students",
        items: people.map((person) => ({
          id: person.id,
          name: person.name,
          designation: person.designation,
          office: "",
          email: person.email,
          contact: "",
          topic: "",
          category: "",
          photo: ""
        }))
      }
    ];
  }

  if (safeType === "administration") {
    return [
      {
        id: "administration-technical",
        title: "Technical",
        items: people.map((person) => ({
          id: person.id,
          name: person.name,
          designation: person.designation,
          office: "",
          email: person.email,
          contact: person.contact || "",
          topic: "",
          category: "",
          photo: ""
        }))
      }
    ];
  }

  const postdocsItems = [];
  const ramunanjanItems = [];
  people.forEach((person) => {
    const normalizedGroup = String(person.group || "").toLowerCase();
    const item = {
      id: person.id,
      name: person.name,
      designation: person.designation,
      office: person.office,
      email: person.email,
      contact: person.contact || "",
      topic: "",
      category: "",
      photo: ""
    };
    if (/ramunanjan|ramanujan/.test(normalizedGroup)) {
      ramunanjanItems.push(item);
      return;
    }
    postdocsItems.push(item);
  });

  return [
    { id: "postdocs-current", title: "Postdocs", items: postdocsItems },
    { id: "ramunanjan-current", title: "Ramunanjan", items: ramunanjanItems }
  ];
}

function ensurePostdocsPeopleGroups(groups) {
  const normalized = normalizePeopleGroups(groups, getDefaultPostdocPeopleGroups());
  const hasPostdocs = normalized.some((group) => group.id === "postdocs-current");
  const hasRamunanjan = normalized.some((group) => group.id === "ramunanjan-current");
  const result = normalized.slice();
  if (!hasPostdocs) {
    result.unshift({ id: "postdocs-current", title: "Postdocs", items: [] });
  }
  if (!hasRamunanjan) {
    result.push({ id: "ramunanjan-current", title: "Ramunanjan", items: [] });
  }
  return normalizePeopleGroups(result, getDefaultPostdocPeopleGroups());
}

function looksLikeTitledPersonName(value) {
  return /^(mr|mrs|ms|miss|dr|prof)\.?\s*[a-z][a-z.' -]*$/i.test(String(value || "").trim());
}

function looksLikePhone(value) {
  const str = String(value || "").trim();
  const digits = str.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+]?[\d\s\-().]+$/.test(str);
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function parseManagedPeopleRowsFromUpload(buffer, extension, type) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const knownColumns = [
    "name", "student name", "researcher name", "postdoc name", "staff name", "full name",
    "email", "email id", "email address", "mail",
    "contact", "contact number", "contact no", "contactno", "phone", "phone number", "phone no", "phoneno", "mobile", "mobile number", "mobile no", "telephone", "cell",
    "designation", "research area", "office", "group", "category", "section", "type"
  ];
  const normalizedKnown = knownColumns.map(normalizeAlumniColumnName);
  const hasColumnHeaders = rows.length && Object.keys(rows[0] || {}).some((column) =>
    normalizedKnown.includes(normalizeAlumniColumnName(column))
  );
  if (hasColumnHeaders) {
    return rows;
  }

  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return matrix.map((cells) => {
    const rawValues = (Array.isArray(cells) ? cells : []).map((cell) => String(cell == null ? "" : cell).trim());
    if (!rawValues.some(Boolean)) {
      return null;
    }
    if (rawValues.some((val) => ["name", "email", "designation", "contact", "contact number", "phone"].includes(val.toLowerCase()))) {
      return null;
    }

    const email = rawValues.find(looksLikeEmail) || "";
    const phone = rawValues.find((val) => val !== email && looksLikePhone(val)) || "";
    const nonEmailPhone = rawValues.filter((val) => Boolean(val) && val !== email && val !== phone);

    let name = "";
    let designation = "";
    let office = "";
    let contact = phone;

    if (type === "administration") {
      name = nonEmailPhone[0] || "";
      designation = nonEmailPhone[1] || "";
      office = nonEmailPhone.slice(2).join(" | ");
      if (!contact) {
        const candidate = rawValues[3] || rawValues[4] || "";
        if (candidate && candidate !== name && candidate !== designation && candidate !== email) {
          contact = candidate;
        }
      }
    } else {
      name = nonEmailPhone.find(Boolean) || "";
      const details = nonEmailPhone.filter((val) => val !== name && (type !== "students" || !looksLikeTitledPersonName(val)));
      designation = details[0] || "";
      office = details.slice(1).join(" | ");
    }

    return {
      Name: name,
      Designation: designation,
      Office: office,
      Email: email,
      Contact: contact,
      Group: ""
    };
  }).filter((row) => row && (row.Name || row.Email || row.Designation || row.Contact || row.Office));
}

function parseAlumniRowsFromUpload(buffer, extension) {
  if (extension === ".pdf") {
    return [];
  }
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const knownColumns = ["name", "student name", "alumni name", "full name", "email", "email id", "email address", "mail", "designation", "category", "program", "course", "degree"];
  const hasColumnHeaders = rows.length && Object.keys(rows[0] || {}).some((column) =>
    knownColumns.includes(String(column || "").trim().toLowerCase())
  );
  if (hasColumnHeaders) {
    return rows;
  }

  // Some spreadsheets contain rows only (no header row). Preserve those rows
  // instead of treating the first alumnus as the column headings.
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return matrix.map((cells) => {
    const values = (Array.isArray(cells) ? cells : []).map((cell) => String(cell == null ? "" : cell).trim());
    const name = values.find(Boolean) || "";
    const email = values.find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || "";
    const details = values.filter((value) => value && value !== name && value !== email);
    return {
      Name: name,
      Email: email,
      Supervisor: details.length ? `Details: ${details.join(" | ")}` : ""
    };
  }).filter((row) => row.Name || row.Email || row.Supervisor);
}

async function saveUploadedImage(payload) {
  const dataUrl = String((payload && payload.dataUrl) || "").trim();
  const fileName = String((payload && payload.fileName) || "").trim();
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,(.+)$/i);
  if (!match) {
    throw new Error("Unsupported image upload format.");
  }

  const mimeType = match[1].toLowerCase();
  const extensions = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg"
  };
  const extension = extensions[mimeType];
  if (!extension) {
    throw new Error("Unsupported image type.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Uploaded image is empty.");
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("Image must be 10 MB or smaller.");
  }

  const safeName = `${sanitizeUploadBasename(fileName)}-${Date.now()}${extension}`;
  const fullPath = path.join(UPLOADS_DIR, safeName);
  await fsp.writeFile(fullPath, buffer);
  await fsp.chmod(fullPath, 0o644).catch(() => {});
  return {
    path: `./uploads/${safeName}`
  };
}

async function saveUploadedPresentation(payload) {
  const dataUrl = String((payload && payload.dataUrl) || "").trim();
  const fileName = String((payload && payload.fileName) || "").trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Unsupported presentation upload format.");
  }

  const mimeType = match[1].toLowerCase();
  const allowedTypes = {
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/pdf": ".pdf"
  };
  const extension = allowedTypes[mimeType] || path.extname(fileName).toLowerCase();
  if (![".ppt", ".pptx", ".pdf"].includes(extension)) {
    throw new Error("Only PPT, PPTX, or PDF files can be uploaded.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Uploaded presentation is empty.");
  }
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error("Presentation must be 20 MB or smaller.");
  }

  const safeName = `presentation-${sanitizeUploadBasename(fileName)}-${Date.now()}${extension}`;
  const fullPath = path.join(UPLOADS_DIR, safeName);
  await fsp.writeFile(fullPath, buffer);
  await fsp.chmod(fullPath, 0o644).catch(() => {});
  return {
    path: `./uploads/${safeName}`,
    fileName: fileName || safeName,
    mimeType,
    uploadedAt: nowIso()
  };
}

async function saveUploadedAlumniFile(payload) {
  const dataUrl = String((payload && payload.dataUrl) || "").trim();
  const fileName = String((payload && payload.fileName) || "").trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Unsupported alumni file upload format.");
  }

  const mimeType = match[1].toLowerCase();
  const allowedTypes = {
    "application/pdf": ".pdf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
    "application/csv": ".csv"
  };
  const extension = allowedTypes[mimeType] || path.extname(fileName).toLowerCase();
  if (![".pdf", ".xls", ".xlsx", ".csv"].includes(extension)) {
    throw new Error("Only PDF, Excel, or CSV files can be uploaded.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Uploaded file is empty.");
  }
  if (buffer.length > 15 * 1024 * 1024) {
    throw new Error("Alumni file must be 15 MB or smaller.");
  }

  const safeName = `alumni-${sanitizeUploadBasename(fileName)}-${Date.now()}${extension}`;
  const fullPath = path.join(UPLOADS_DIR, safeName);
  await fsp.writeFile(fullPath, buffer);
  const parsedPeopleGroups = buildAlumniPeopleGroupsFromRows(parseAlumniRowsFromUpload(buffer, extension));
  if (extension !== ".pdf" && !parsedPeopleGroups.length) {
    await fsp.unlink(fullPath).catch(() => { });
    throw new Error("No alumni rows were found. Add data rows to the first worksheet and upload the file again.");
  }
  return {
    path: `./uploads/${safeName}`,
    fileName: fileName || safeName,
    mimeType,
    uploadedAt: nowIso(),
    parsedPeopleGroups
  };
}

async function saveUploadedManagedPeopleFile(payload, type) {
  if (![("postdocs"), ("students"), ("administration")].includes(type)) {
    throw new Error("Unsupported people upload type.");
  }
  const dataUrl = String((payload && payload.dataUrl) || "").trim();
  const fileName = String((payload && payload.fileName) || "").trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Unsupported file upload format.");
  }

  const mimeType = match[1].toLowerCase();
  const allowedTypes = {
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
    "application/csv": ".csv"
  };
  const extension = allowedTypes[mimeType] || path.extname(fileName).toLowerCase();
  if (![".xls", ".xlsx", ".csv"].includes(extension)) {
    throw new Error("Only Excel or CSV files can be uploaded.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Uploaded file is empty.");
  }
  if (buffer.length > 15 * 1024 * 1024) {
    throw new Error("File must be 15 MB or smaller.");
  }

  const safeName = `${type}-${sanitizeUploadBasename(fileName)}-${Date.now()}${extension}`;
  const fullPath = path.join(UPLOADS_DIR, safeName);
  await fsp.writeFile(fullPath, buffer);
  const parsedPeopleGroups = buildManagedPeopleGroupsFromRows(parseManagedPeopleRowsFromUpload(buffer, extension, type), type);
  const totalPeople = parsedPeopleGroups.reduce((count, group) => count + (Array.isArray(group.items) ? group.items.length : 0), 0);
  if (!totalPeople) {
    await fsp.unlink(fullPath).catch(() => { });
    throw new Error("No people rows were found. Add data rows to the first worksheet and upload the file again.");
  }

  return {
    path: `./uploads/${safeName}`,
    fileName: fileName || safeName,
    mimeType,
    uploadedAt: nowIso(),
    parsedPeopleGroups
  };
}

function pickManagedPeopleGroupItems(upload, groupId) {
  const parsedGroups = Array.isArray(upload && upload.parsedPeopleGroups) ? upload.parsedPeopleGroups : [];
  if (!parsedGroups.length) {
    return [];
  }
  const allItems = parsedGroups.reduce((result, group) => {
    const items = Array.isArray(group && group.items) ? group.items : [];
    return result.concat(items);
  }, []);
  if (!allItems.length) {
    return [];
  }
  return allItems.map((item, index) => ({
    id: `${groupId}-upload-${index + 1}-${slugifyId(item.name || item.email, "person")}`,
    name: String(item.name || "").trim(),
    designation: String(item.designation || "").trim(),
    office: String(item.office || "").trim(),
    email: String(item.email || "").trim(),
    topic: "",
    category: "",
    photo: ""
  }));
}

function getTokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  return String(url.searchParams.get("token") || "").trim();
}

function findUserByCredential(users, credential) {
  const normalized = normalizeCredential(credential);
  return users.find((user) => normalizeEmail(user.email) === normalized || normalizeCredential(user.loginId) === normalized);
}

async function seedDefaultUsers() {
  const usersStore = await readUsers();
  const facultyStore = await readFacultyStore();
  const siteStore = await readSiteStore();
  let changed = false;

  function defaultPermissions(role) {
    return deepClone(siteStore.settings.rolePermissions[role] || []);
  }

  const superAdmin = usersStore.users.find((user) => user.role === "superadmin");
  if (!superAdmin) {
    const salt = crypto.randomBytes(16).toString("hex");
    usersStore.users.push({
      id: crypto.randomUUID(),
      role: "superadmin",
      status: "active",
      facultyId: "",
      loginId: "superadmin",
      name: "Super Admin",
      email: "superadmin@phy.iitkgp.ac.in",
      permissions: defaultPermissions("superadmin"),
      salt,
      passwordHash: hashPassword("Super@123", salt),
      createdAt: nowIso(),
      tokens: []
    });
    changed = true;
  }

  for (const faculty of facultyStore.faculty) {
    const existing = usersStore.users.find((user) => normalizeEmail(user.email) === normalizeEmail(faculty.email) || normalizeCredential(user.loginId) === normalizeCredential(faculty.loginId));
    if (existing) {
      if (!existing.role) { existing.role = "faculty"; changed = true; }
      if (!existing.status) { existing.status = "active"; changed = true; }
      if (!Array.isArray(existing.permissions)) { existing.permissions = defaultPermissions(existing.role); changed = true; }
      if (existing.name !== faculty.name) { existing.name = faculty.name; changed = true; }
      if (existing.facultyId !== faculty.facultyId) { existing.facultyId = faculty.facultyId; changed = true; }
      if (existing.loginId !== faculty.loginId) { existing.loginId = faculty.loginId; changed = true; }
      continue;
    }

    const salt = crypto.randomBytes(16).toString("hex");
    usersStore.users.push({
      id: crypto.randomUUID(),
      role: "faculty",
      status: "active",
      facultyId: faculty.facultyId,
      loginId: faculty.loginId,
      name: faculty.name,
      email: faculty.email,
      permissions: defaultPermissions("faculty"),
      salt,
      passwordHash: hashPassword(faculty.initialPassword, salt),
      createdAt: nowIso(),
      tokens: []
    });
    changed = true;
  }

  if (changed) {
    await writeUsers(usersStore);
  }
}

function addNotification(portalStore, notification) {
  portalStore.notifications.unshift({
    id: createId("notify"),
    createdAt: nowIso(),
    readBy: [],
    ...notification
  });
}

function getUserNotifications(portalStore, user) {
  return portalStore.notifications.filter((item) => {
    if (item.targetRole && item.targetRole === user.role) {
      return true;
    }
    return item.targetEmail && normalizeEmail(item.targetEmail) === normalizeEmail(user.email);
  });
}

function createStatusType(status) {
  if (status === "Approved" || status === "Resolved" || status === "Active") {
    return "success";
  }
  if (status === "In Progress" || status === "Admin") {
    return "info";
  }
  if (status === "Rejected" || status === "Suspended") {
    return "danger";
  }
  return "warning";
}

function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isBlockedSlot(date, time, portalStore) {
  return portalStore.blockedDates.includes(date) || portalStore.blockedSlots.some((item) => item.date === date && item.time === time);
}

function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function hasRangeConflict(existingStart, existingEnd, requestedStart, requestedEnd) {
  return requestedStart < existingEnd && requestedEnd > existingStart;
}

function findBookingConflict(portalStore, payload) {
  const date = String(payload.date || "").trim();
  const startTime = String(payload.startTime || "").trim();
  const endTime = String(payload.endTime || "").trim();
  const bookingType = payload.type === "zoom" ? "zoom" : (payload.type === "facility" ? "facility" : "seminar");
  const resource = bookingType === "zoom"
    ? String(payload.topic || "").trim().toLowerCase()
    : String(payload.roomName || "").trim().toLowerCase();
  const requestedStart = parseTimeToMinutes(startTime);
  const requestedEnd = parseTimeToMinutes(endTime);
  if (requestedStart === null || requestedEnd === null || requestedStart >= requestedEnd) {
    return { invalid: true };
  }

  const collection = bookingType === "zoom" ? portalStore.zoomBookings : (bookingType === "facility" ? portalStore.facilityBookings : portalStore.seminarRequests);
  const conflict = collection.find((item) => {
    if (String(item.date || "").trim() !== date) {
      return false;
    }
    const itemResource = bookingType === "zoom"
      ? String(item.topic || "").trim().toLowerCase()
      : String(item.roomName || "").trim().toLowerCase();
    if (resource && itemResource && resource !== itemResource) {
      return false;
    }
    const itemStart = parseTimeToMinutes(String(item.startTime || item.time || "").trim());
    const itemEnd = parseTimeToMinutes(String(item.endTime || item.time || "").trim());
    if (itemStart === null || itemEnd === null || itemStart >= itemEnd) {
      return false;
    }
    return hasRangeConflict(itemStart, itemEnd, requestedStart, requestedEnd);
  });

  return { conflict: conflict || null };
}

function createManagedBooking(portalStore, payload) {
  const bookingType = payload.type === "zoom" ? "zoom" : "seminar";
  const collection = bookingType === "zoom" ? portalStore.zoomBookings : portalStore.seminarRequests;
  const booking = {
    id: createId(bookingType),
    requesterName: String(payload.requesterName || "Super Admin").trim(),
    requesterEmail: String(payload.requesterEmail || "superadmin@phy.iitkgp.ac.in").trim(),
    date: String(payload.date || "").trim(),
    time: String(payload.time || payload.startTime || "").trim(),
    startTime: String(payload.startTime || payload.time || "").trim(),
    endTime: String(payload.endTime || payload.time || "").trim(),
    notes: String(payload.notes || "").trim(),
    status: "Approved",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (bookingType === "zoom") {
    booking.topic = String(payload.topic || "Managed Zoom Booking").trim();
  } else {
    booking.roomName = String(payload.roomName || "Managed Seminar Booking").trim();
  }

  collection.unshift(booking);
  return booking;
}

function hasPermission(user, permission, siteStore) {
  if (!user) {
    return false;
  }
  if (user.role === "superadmin") {
    return true;
  }
  const permissions = Array.isArray(user.permissions) && user.permissions.length
    ? user.permissions
    : (siteStore.settings.rolePermissions[user.role] || []);
  return permissions.includes("all") || permissions.includes(permission);
}

// Returns booking privilege info for a user based on their special booking permissions
function getBookingPrivilege(user) {
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes("booking_timetable_incharge")) {
    return { type: "timetable_incharge", label: "Timetable In-Charge", maxDays: 120, description: "Semester-wide booking (up to 120 days range)" };
  }
  if (perms.includes("booking_conference_incharge")) {
    return { type: "conference_incharge", label: "Conference/Seminar Organizer", maxDays: 42, description: "Extended booking (up to 6 weeks range)" };
  }
  if (perms.includes("booking_exam_incharge")) {
    return { type: "exam_incharge", label: "Exam In-Charge", maxDays: 7, description: "Weekly booking (up to 7 days range)" };
  }
  if (perms.includes("booking_seminar_incharge")) {
    return { type: "seminar_incharge", label: "Seminar In-Charge", maxDays: 7, description: "Multi-day booking (up to 7 days range)" };
  }
  return null;
}

function purgeExpiredTokens(user) {
  if (!Array.isArray(user.tokens) || !user.tokens.length) {
    return false;
  }
  const now = Date.now();
  const before = user.tokens.length;
  user.tokens = user.tokens.filter(t => {
    const tokenCreatedAt = typeof t === "string" ? null : (t && t.createdAt);
    if (tokenCreatedAt) {
      return (now - new Date(tokenCreatedAt).getTime()) <= AUTH_TOKEN_EXPIRY;
    }
    return true;
  });
  return user.tokens.length !== before;
}

async function getAuthenticatedUser(req) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }
  const usersStore = await readUsers();
  let needsWrite = false;
  const user = usersStore.users.find((item) => {
    if (!Array.isArray(item.tokens)) return false;
    // Purge expired tokens opportunistically
    if (purgeExpiredTokens(item)) {
      needsWrite = true;
    }
    return item.tokens.some(t => {
      const tokenValue = typeof t === "string" ? t : (t && t.value);
      const tokenCreatedAt = typeof t === "string" ? null : (t && t.createdAt);
      if (tokenValue !== token) return false;
      if (tokenCreatedAt) {
        const createdTime = new Date(tokenCreatedAt).getTime();
        const nowTime = Date.now();
        if (nowTime - createdTime > AUTH_TOKEN_EXPIRY) return false;
      }
      return true;
    });
  });
  if (needsWrite) {
    await writeUsers(usersStore);
  }
  if (!user || user.status === "suspended" || user.status === "pending") {
    return null;
  }
  return user;
}

async function getFacultyProfileForUser(user) {
  const facultyStore = await readFacultyStore();
  const matchedProfile = facultyStore.faculty.find((item) => isSameFacultyProfile(item, user));
  if (matchedProfile) {
    return matchedProfile;
  }
  return createFacultyProfileFromUser(user);
}

function buildFacultyActivity(portalStore) {
  return []
    .concat(portalStore.tickets.map((item) => ({
      title: item.subject,
      actor: item.requesterName,
      type: "ticket",
      meta: `${item.category} • ${formatRelativeTime(item.createdAt)}`,
      status: item.status,
      statusType: createStatusType(item.status),
      createdAt: item.createdAt,
      href: "./admin-tickets.html"
    })))
    .concat(portalStore.seminarRequests.map((item) => ({
      title: `Seminar: ${item.roomName}`,
      actor: item.requesterName,
      type: "seminar",
      meta: `${item.date} ${item.time}`,
      status: item.status,
      statusType: createStatusType(item.status),
      createdAt: item.createdAt,
      href: "./admin-bookings.html?type=seminar"
    })))
    .concat(portalStore.zoomBookings.map((item) => ({
      title: `Zoom: ${item.topic}`,
      actor: item.requesterName,
      type: "zoom",
      meta: `${item.date} ${item.time}`,
      status: item.status,
      statusType: createStatusType(item.status),
      createdAt: item.createdAt,
      href: "./admin-bookings.html?type=zoom"
    })))
    .concat(portalStore.notices.map((item) => ({
      title: `Notice: ${item.title}`,
      actor: item.authorName,
      type: "notice",
      meta: `${item.category} • ${formatRelativeTime(item.publishedAt)}`,
      status: "Published",
      statusType: "success",
      createdAt: item.publishedAt,
      href: `./admin-notices.html?category=${encodeURIComponent(item.category)}`
    })))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getDashboardPayload(user) {
  const portalStore = await readPortalStore();
  const siteStore = await readSiteStore();
  const notices = portalStore.notices.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const userTickets = portalStore.tickets.filter((item) => normalizeEmail(item.requesterEmail) === normalizeEmail(user.email));
  const seminarRequests = portalStore.seminarRequests.filter((item) => normalizeEmail(item.requesterEmail) === normalizeEmail(user.email));
  const zoomBookings = portalStore.zoomBookings.filter((item) => normalizeEmail(item.requesterEmail) === normalizeEmail(user.email));
  const unreadNotifications = getUserNotifications(portalStore, user).filter((item) => !item.readBy.includes(normalizeEmail(user.email)));
  const activeTickets = userTickets.filter((item) => !["Resolved", "Rejected", "Closed"].includes(item.status));
  const approvedBookings = seminarRequests.concat(zoomBookings).filter((item) => item.status === "Approved");
  const pendingRequests = seminarRequests.concat(zoomBookings).filter((item) => item.status === "Pending");
  const academicNotices = notices.filter((item) => item.category === "Academic").length;
  const activity = buildFacultyActivity(portalStore).filter((item) => item.actor === user.name).slice(0, 8);
  const quickActions = [
    { title: "Raise Ticket", description: "Submit a new service or maintenance request", primary: true, href: "./admin-tickets.html" },
    { title: "Book a Seminar", description: "Reserve seminar halls for departmental events", href: "./admin-bookings.html?type=seminar" },
    { title: "Zoom Booking", description: "Create and track Zoom session requests", href: "./admin-bookings.html?type=zoom" },
    { title: "View Notices", description: "Add, publish, and manage department notices", href: "./admin-notices.html" },
    { title: "News & Events", description: "Push announcements and manage upcoming/past events", href: "./admin-news-events.html" }
  ];
  const modules = [
    { name: "Public Notices", count: notices.length, href: "./admin-notices.html" },
    { name: "News & Events", count: 1, href: "./admin-news-events.html" },
    { name: "Faculty Zone", count: 1, href: "./admin-profile.html" },
    { name: "CMSTS Tickets", count: userTickets.length, href: "./admin-tickets.html" },
    { name: "Notifications", count: unreadNotifications.length, href: "./admin-notifications.html" }
  ];
  if (hasPermission(user, "hpc_facility", siteStore)) {
    quickActions.push({ title: "HPC Facility", description: "Review submitted HPC account forms", href: "./admin-module.html?module=computational-access&title=HPC%20Facility" });
    modules.push({ name: "HPC Requests", count: portalStore.hpcAccountRequests.length, href: "./admin-module.html?module=computational-access&title=HPC%20Facility" });
  }

  return {
    greeting: getGreeting(),
    dateLabel: formatPortalDate(nowIso()),
    user: createPublicUser(user),
    noticeDot: unreadNotifications.length > 0,
    stats: [
      {
        title: "Active Tickets",
        value: activeTickets.length,
        icon: String(activeTickets.length),
        detail: `${userTickets.filter((item) => item.status === "Pending").length} pending review`,
        trend: userTickets.length ? `+ ${userTickets.length} total raised` : "+ 0 total raised",
        href: "./admin-tickets.html"
      },
      {
        title: "Room Bookings",
        value: approvedBookings.length,
        icon: String(approvedBookings.length),
        detail: "Approved bookings",
        href: "./admin-bookings.html?type=seminar"
      },
      {
        title: "Unread Notices",
        value: notices.length,
        icon: String(notices.length),
        detail: `${academicNotices} academic`,
        trend: `+ ${notices.length} total published`,
        href: "./admin-notices.html"
      },
      {
        title: "Pending Requests",
        value: pendingRequests.length,
        icon: String(pendingRequests.length),
        detail: "Awaiting super admin clearance",
        href: "./admin-bookings.html?type=seminar"
      }
    ],
    quickActions,
    recentActivity: activity,
    modules
  };
}

async function getSuperadminOverviewPayload(user) {
  const usersStore = await readUsers();
  const portalStore = await readPortalStore();
  const siteStore = await readSiteStore();
  const notifications = getUserNotifications(portalStore, user);
  const activity = buildFacultyActivity(portalStore).slice(0, 12);
  const activeAdmins = usersStore.users.filter((item) => item.role === "admin" && item.status === "active");
  const suspendedUsers = usersStore.users.filter((item) => item.status === "suspended");
  const totalBookings = portalStore.seminarRequests.length + portalStore.zoomBookings.length;
  const openTickets = portalStore.tickets.filter((item) => item.status === "Pending" || item.status === "In Progress").length;
  const resolvedTickets = portalStore.tickets.filter((item) => item.status === "Resolved").length;
  const managedPages = Array.isArray(siteStore.content.pages) ? siteStore.content.pages.length : 0;

  return {
    greeting: getGreeting(),
    dateLabel: formatPortalDate(nowIso()),
    user: createPublicUser(user),
    noticeDot: notifications.filter((item) => !item.readBy.includes(normalizeEmail(user.email))).length > 0,
    stats: [
      { title: "Managed Pages", value: managedPages, icon: String(managedPages), detail: `${siteStore.content.homepage.heroImages ? siteStore.content.homepage.heroImages.length : 0} homepage visuals` },
      { title: "Active Admins", value: activeAdmins.length, icon: String(activeAdmins.length), detail: `${suspendedUsers.length} suspended users` },
      { title: "Total Bookings", value: totalBookings, icon: String(totalBookings), detail: `${portalStore.seminarRequests.length} seminar / ${portalStore.zoomBookings.length} zoom` },
      { title: "Open Tickets", value: openTickets, icon: String(openTickets), detail: `${portalStore.tickets.length} total tickets` },
      { title: "Notifications", value: notifications.length, icon: String(notifications.length), detail: "Content, booking, and ticket alerts" }
    ],
    quickActions: [
      { title: "User Management", description: "Activate, suspend, or promote faculty accounts", primary: true, href: "./superadmin-users.html" },
      { title: "HPC Facility Forms", description: "Review and process HPC computing access forms", href: "./admin-module.html?module=computational-access&title=HPC%20Facility" },
      { title: "Homepage Editor", description: "Edit hero text, placement, and homepage images", href: "./superadmin-page-editor.html?id=page-home" },
      { title: "News & Events", description: "Manage announcements and events published on website", href: "./superadmin-news-events.html" },
      { title: "Booking Control", description: "Approve requests and block dates or time slots", href: "./superadmin-bookings.html" },
      { title: "Site Settings", description: "Maintenance mode, permissions, and platform rules", href: "./superadmin-settings.html" }
    ],
    ticketMetrics: {
      total: portalStore.tickets.length,
      resolved: resolvedTickets
    },
    recentActivity: activity,
    modules: [
      { name: "Faculty Accounts", count: usersStore.users.filter((item) => item.role === "faculty").length },
      { name: "Admin Accounts", count: usersStore.users.filter((item) => item.role === "admin").length },
      { name: "Published Notices", count: portalStore.notices.length },
      { name: "Blocked Slots", count: portalStore.blockedSlots.length + portalStore.blockedDates.length }
    ]
  };
}

async function broadcastDashboardUpdate(targetEmail) {
  const clients = Array.from(dashboardStreamClients);
  for (const client of clients) {
    try {
      if (targetEmail && normalizeEmail(client.user.email) !== normalizeEmail(targetEmail) && client.user.role !== "superadmin") {
        continue;
      }
      const payload = client.user.role === "superadmin"
        ? await getSuperadminOverviewPayload(client.user)
        : await getDashboardPayload(client.user);
      sendSseEvent(client.res, "dashboard", payload);
    } catch (error) {
      dashboardStreamClients.delete(client);
      try {
        client.res.end();
      } catch (endError) {
        // Ignore closed stream cleanup errors.
      }
    }
  }
}

function startPortalFileWatcher() {
  if (portalFileWatcherStarted) {
    return;
  }
  portalFileWatcherStarted = true;
  fs.watch(PORTAL_FILE, { persistent: false }, () => {
    broadcastDashboardUpdate().catch(() => { });
  });
  fs.watch(SITE_FILE, { persistent: false }, () => {
    broadcastDashboardUpdate().catch(() => { });
  });
  fs.watch(USERS_FILE, { persistent: false }, () => {
    broadcastDashboardUpdate().catch(() => { });
  });
}

async function createAdminInvitation(req, payload) {
  const name = String(payload.name || "").trim();
  const email = normalizeEmail(payload.email);
  if (!name || !email) {
    return { status: 400, body: { message: "Admin name and email are required." } };
  }

  const usersStore = await readUsers();
  const siteStore = await readSiteStore();
  const existingUser = usersStore.users.find((item) => normalizeEmail(item.email) === email);
  let user = existingUser || null;
  const invitationTime = nowIso();
  const rawToken = createToken();
  const invitation = {
    tokenHash: hashInvitationToken(rawToken),
    invitedAt: existingUser && existingUser.invitation && existingUser.invitation.invitedAt ? existingUser.invitation.invitedAt : invitationTime,
    expiresAt: addHours(invitationTime, 24),
    lastSentAt: invitationTime,
    usedAt: ""
  };

  if (user) {
    normalizeManagedUser(user);
    if (user.role !== 'admin') {
      return { status: 409, body: { message: 'A non-admin account with this email already exists.' } };
    }
    if (user.invitationStatus === 'active' && user.status === 'active') {
      return { status: 409, body: { message: 'An active Admin account with this email already exists.' } };
    }
    user.name = name;
    user.email = email;
    user.loginId = user.loginId || email.split('@')[0];
    user.status = 'pending';
    user.invitationStatus = 'pending';
    user.invitation = invitation;
    user.tokens = [];
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    user = normalizeManagedUser({
      id: crypto.randomUUID(),
      role: 'admin',
      status: 'pending',
      facultyId: '',
      loginId: email.split('@')[0],
      name,
      email,
      permissions: deepClone(siteStore.settings.rolePermissions.admin || []),
      salt,
      passwordHash: hashPassword(createToken(), salt),
      createdAt: invitationTime,
      tokens: [],
      invitationStatus: 'pending',
      invitation,
      lastLoginAt: ''
    });
    usersStore.users.push(user);
  }

  await writeUsers(usersStore);
  const setupLink = await sendAdminInvitationEmail(req, siteStore.settings, user, rawToken);
  return {
    status: existingUser ? 200 : 201,
    body: {
      message: 'Invitation sent successfully.',
      user: mapUserForManagement(user),
      setupLink: (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) ? setupLink : undefined
    }
  };
}

async function resendAdminInvitation(req, userId) {
  const usersStore = await readUsers();
  const user = usersStore.users.find((item) => item.id === userId);
  if (!user) {
    return { status: 404, body: { message: 'User not found.' } };
  }
  normalizeManagedUser(user);
  if (user.role !== 'admin') {
    return { status: 400, body: { message: 'Only Admin invitations can be resent.' } };
  }
  if (user.invitationStatus !== 'pending') {
    return { status: 409, body: { message: 'This Admin account is already active.' } };
  }

  const siteStore = await readSiteStore();
  const sentAt = nowIso();
  const rawToken = createToken();
  user.invitation = {
    tokenHash: hashInvitationToken(rawToken),
    invitedAt: user.invitation && user.invitation.invitedAt ? user.invitation.invitedAt : sentAt,
    expiresAt: addHours(sentAt, 24),
    lastSentAt: sentAt,
    usedAt: ''
  };
  await writeUsers(usersStore);
  const setupLink = await sendAdminInvitationEmail(req, siteStore.settings, user, rawToken);
  return {
    status: 200,
    body: {
      message: 'Invitation resent successfully.',
      user: mapUserForManagement(user),
      setupLink: (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) ? setupLink : undefined
    }
  };
}

async function getInvitationDetails(token) {
  const invitationToken = String(token || '').trim();
  if (!invitationToken) {
    return { status: 400, body: { message: 'Invitation token is required.' } };
  }
  const usersStore = await readUsers();
  const user = findUserByInvitationToken(usersStore.users, invitationToken);
  if (!user) {
    return { status: 404, body: { message: 'This invitation link is invalid or has already been used.' } };
  }
  const state = getInvitationState(user);
  if (!state.valid) {
    return { status: 400, body: { message: state.message } };
  }
  return {
    status: 200,
    body: {
      invitation: {
        name: user.name,
        email: user.email,
        status: user.invitationStatus,
        expiresAt: user.invitation.expiresAt
      }
    }
  };
}

async function setupInvitedAdmin(token, payload) {
  const invitationToken = String(token || '').trim();
  const password = String(payload.password || '');
  if (!invitationToken) {
    return { status: 400, body: { message: 'Invitation token is required.' } };
  }
  if (password.length < 8) {
    return { status: 400, body: { message: 'Password must be at least 8 characters long.' } };
  }

  const usersStore = await readUsers();
  const user = findUserByInvitationToken(usersStore.users, invitationToken);
  if (!user) {
    return { status: 404, body: { message: 'This invitation link is invalid or has already been used.' } };
  }
  const state = getInvitationState(user);
  if (!state.valid) {
    return { status: 400, body: { message: state.message } };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.passwordHash = hashPassword(password, salt);
  user.status = 'active';
  user.invitationStatus = 'active';
  user.invitation = {
    tokenHash: '',
    invitedAt: user.invitation ? user.invitation.invitedAt : nowIso(),
    expiresAt: '',
    lastSentAt: user.invitation ? user.invitation.lastSentAt : nowIso(),
    usedAt: nowIso()
  };
  user.tokens = [];
  await writeUsers(usersStore);

  return {
    status: 200,
    body: {
      message: 'Password set successfully. You can now log in.',
      user: createPublicUser(user)
    }
  };
}

async function requestPasswordReset(req, payload) {
  const email = normalizeEmail(payload.email);
  const genericMessage = "If an account with that email exists, a password reset link has been sent.";
  if (!email) {
    return { status: 400, body: { message: "Email is required." } };
  }

  const usersStore = await readUsers();
  const user = findUserByCredential(usersStore.users, email);
  if (!user) {
    return { status: 200, body: { message: genericMessage } };
  }

  const siteStore = await readSiteStore();
  const rawToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = hashInvitationToken(rawToken);
  user.resetPasswordExpires = addHours(nowIso(), 1);
  user.resetPasswordUsedAt = "";
  user.tokens = [];
  await writeUsers(usersStore);

  const resetLink = await sendPasswordResetEmail(req, siteStore.settings, user, rawToken);
  return {
    status: 200,
    body: {
      message: genericMessage,
      resetLink: (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) ? resetLink : undefined
    }
  };
}

async function getResetPasswordDetails(token) {
  const resetToken = String(token || "").trim();
  if (!resetToken) {
    return { status: 400, body: { message: "Reset token is required." } };
  }
  const usersStore = await readUsers();
  const user = findUserByResetPasswordToken(usersStore.users, resetToken);
  if (!user) {
    return { status: 404, body: { message: "This password reset link is invalid or has already been used." } };
  }
  const state = getResetPasswordState(user);
  if (!state.valid) {
    return { status: 400, body: { message: state.message } };
  }
  return {
    status: 200,
    body: {
      reset: {
        name: user.name,
        email: user.email,
        expiresAt: user.resetPasswordExpires
      }
    }
  };
}

async function resetPasswordWithToken(token, payload) {
  const resetToken = String(token || "").trim();
  const password = String(payload.password || "");
  if (!resetToken) {
    return { status: 400, body: { message: "Reset token is required." } };
  }
  if (password.length < 8) {
    return { status: 400, body: { message: "Password must be at least 8 characters long." } };
  }

  const usersStore = await readUsers();
  const user = findUserByResetPasswordToken(usersStore.users, resetToken);
  if (!user) {
    return { status: 404, body: { message: "This password reset link is invalid or has already been used." } };
  }
  const state = getResetPasswordState(user);
  if (!state.valid) {
    return { status: 400, body: { message: state.message } };
  }

  user.passwordHash = bcrypt.hashSync(password, 10);
  user.salt = crypto.randomBytes(16).toString("hex");
  clearResetPasswordState(user);
  user.tokens = [];
  await writeUsers(usersStore);

  return {
    status: 200,
    body: {
      message: "Password reset successfully. You can now log in."
    }
  };
}

async function registerUser(payload) {
  const name = String(payload.name || "").trim();
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const requestedRole = String(payload.role || "faculty").trim().toLowerCase();

  if (!name || !email || !password) {
    return { status: 400, body: { message: "Name, email, and password are required." } };
  }
  if (name.length < 2 || name.length > 100) {
    return { status: 400, body: { message: "Name must be between 2 and 100 characters." } };
  }
  if (!validateEmail(email)) {
    return { status: 400, body: { message: "Invalid email format." } };
  }
  if (password.length < 8) {
    return { status: 400, body: { message: "Password must be at least 8 characters long." } };
  }
  if (password.length > 256) {
    return { status: 400, body: { message: "Password is too long." } };
  }

  const usersStore = await readUsers();
  if (findUserByCredential(usersStore.users, email)) {
    return { status: 409, body: { message: "An account with this email already exists." } };
  }
  const siteStore = await readSiteStore();
  const role = requestedRole === "superadmin" ? "superadmin" : "faculty";
  if (requestedRole === 'admin') {
    return { status: 403, body: { message: 'Admin self-registration is disabled. Contact Super Admin for an invitation.' } };
  }
  if (role === "superadmin") {
    const accessKey = String(payload.accessKey || "").trim();
    const configuredKey = String(siteStore.settings.superadminSignupKey || "").trim();
    if (!configuredKey) {
      return { status: 403, body: { message: "Super admin signup is not enabled yet. Configure a signup key in settings first." } };
    }
    if (!accessKey || accessKey !== configuredKey) {
      return { status: 403, body: { message: "Invalid super admin signup key." } };
    }
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const now = nowIso();
  const user = normalizeManagedUser({
    id: crypto.randomUUID(),
    role,
    status: role === "superadmin" ? "active" : "pending",
    facultyId: "",
    loginId: email.split("@")[0],
    name,
    email,
    permissions: deepClone(siteStore.settings.rolePermissions[role] || []),
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now,
    tokens: [],
    invitationStatus: role === 'superadmin' ? 'active' : 'pending',
    invitation: {
      tokenHash: '',
      invitedAt: now,
      expiresAt: '',
      lastSentAt: now,
      usedAt: ''
    },
    lastLoginAt: ''
  });

  usersStore.users.push(user);
  await writeUsers(usersStore);
  if (role === "superadmin") {
    const token = createToken();
    user.tokens.push(createTokenRecord(token));
    await writeUsers(usersStore);
    return { status: 201, body: { message: "Super admin account created successfully.", token, user: createPublicUser(user) } };
  }
  return { status: 201, body: { message: "Registration submitted successfully. Wait for super admin approval before logging in." } };
}

async function verifyTurnstileToken(token, remoteIp) {
  if (!TURNSTILE_SECRET_KEY) {
    return { success: true };
  }
  if (!token) {
    return { success: false, message: "CAPTCHA verification is required." };
  }
  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: remoteIp || ""
    });
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const result = await response.json();
    return result.success
      ? { success: true }
      : { success: false, message: "CAPTCHA verification failed. Please try again." };
  } catch (error) {
    console.error("Turnstile verification error:", error.message);
    return { success: false, message: "CAPTCHA verification service unavailable." };
  }
}

async function loginUser(payload) {
  const credential = String(payload.email || payload.loginId || payload.credential || '').trim();
  const password = String(payload.password || '');
  if (!credential || !password) {
    return { status: 400, body: { message: 'Faculty ID or email and password are required.' } };
  }

  const usersStore = await readUsers();
  const user = findUserByCredential(usersStore.users, credential);
  if (!user || !verifyPassword(password, user)) {
    return { status: 401, body: { message: 'Invalid faculty ID, email, or password.' } };
  }
  if (isPendingAdminInvitation(user)) {
    return { status: 403, body: { message: 'Your Admin invitation is still pending. Use the password setup link from your email first.' } };
  }
  if (user.status === 'pending') {
    return { status: 403, body: { message: 'Your registration is pending super admin approval.' } };
  }
  if (user.status === 'suspended') {
    return { status: 403, body: { message: 'This account has been suspended by super admin.' } };
  }

  // Session regeneration: invalidate all previous tokens on fresh login
  user.tokens = [];
  const token = createToken();
  user.tokens.push(createTokenRecord(token));
  user.lastLoginAt = nowIso();
  await writeUsers(usersStore);
  return { status: 200, body: { message: 'Login successful.', token, user: createPublicUser(user) } };
}

function assertSuperAdmin(user, res) {
  if (!user || (user.role !== "superadmin" && !user.isContentEditor)) {
    sendJson(res, 403, { message: "Super admin access required." });
    return false;
  }
  return true;
}


function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function validateInput(value, { required = false, minLength = 0, maxLength = Infinity, pattern = null } = {}) {
  const str = String(value || "").trim();
  if (required && !str) return false;
  if (str.length < minLength || str.length > maxLength) return false;
  if (pattern && !pattern.test(str)) return false;
  return true;
}

function assertAdministrationEditor(user, res) {
  if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
    sendJson(res, 403, { message: "Admin or Super Admin access required." });
    return false;
  }
  return true;
}

function assertNewsEventsEditor(user, res, siteStore) {
  if (!user) {
    sendJson(res, 403, { message: "Login required." });
    return false;
  }
  if (user.role === "superadmin") {
    return true;
  }
  if (!hasPermission(user, "manage_news_events", siteStore)) {
    sendJson(res, 403, { message: "Superadmin has not granted News & Events access for this account." });
    return false;
  }
  return true;
}

function assertContentEditor(user, res, siteStore) {
  if (!user) {
    sendJson(res, 403, { message: "Login required." });
    return false;
  }
  if (user.role === "superadmin" || hasPermission(user, "manage_content", siteStore)) {
    return true;
  }
  sendJson(res, 403, { message: "Superadmin has not granted Content Management access for this account." });
  return false;
}

async function serveStaticFile(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let reqPath = decodeURIComponent(parsedUrl.pathname);

  // Custom login portal routes
  if (reqPath === "/admin-portal" || reqPath === "/admin-portal.html") {
    reqPath = "/admin-login.html";
  } else if (reqPath === "/super-portal" || reqPath === "/super-portal.html") {
    reqPath = "/admin-login.html";
    parsedUrl.searchParams.set("role", "superadmin");
  }
  // Note: /admin-login.html direct access is allowed — on nginx deployments
  // nginx serves it as a static file directly. On Node-only deployments it
  // is still accessible but discouraged; we rely on /admin-portal as the
  // canonical URL shown to users.

  if (reqPath === "/giving.html" || reqPath === "/giving") {
    res.writeHead(301, { Location: "/" });
    res.end();
    return;
  }

  if (reqPath === "/hpc-account" || reqPath === "/hpc-account/") {
    reqPath = "/hpc-account.html";
  }

  if (reqPath === "/") {
    reqPath = "/index.html";
  }
  const safePath = reqPath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(FRONTEND_DIR, safePath);
  if (!resolvedPath.startsWith(FRONTEND_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const siteStore = await readSiteStore();
  const isHtmlRequest = reqPath.endsWith(".html") || reqPath === "/" || reqPath === "/index.html";
  const isAdminPage = /(^\/admin-|^\/superadmin-|\/admin-login\.html$)/.test(reqPath);
  if (siteStore.settings.maintenanceMode && isHtmlRequest && !isAdminPage) {
    sendHtml(res, 503, getMaintenanceHtml(siteStore.settings.maintenanceMessage));
    return;
  }

  let filePath = resolvedPath;
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch (error) {
    const fallbackPath = path.join(FRONTEND_DIR, "index.html");
    const html = await fsp.readFile(fallbackPath);
    sendHtml(res, 200, html);
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const etag = `W/"${stat.size}-${Number(new Date(stat.mtimeMs))}"`;
    const ifNoneMatch = String(req.headers["if-none-match"] || "");
    const isHtmlFile = extension === ".html";
    const cacheControl = isHtmlFile
      ? "no-cache, must-revalidate"
      : "public, max-age=604800, immutable";
    const extraFileHeaders = extension === ".svg"
      ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }
      : {};
    if (ifNoneMatch === etag) {
      res.writeHead(304, {
        ETag: etag,
        "Cache-Control": cacheControl,
        ...extraFileHeaders,
        ...getSecurityHeaders()
      });
      res.end();
      return;
    }
    const file = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      ETag: etag,
      ...extraFileHeaders,
      ...getSecurityHeaders()
    });
    res.end(file);
  } catch (error) {
    sendText(res, 404, "Not Found");
  }
}

function mapUserForManagement(user) {
  const account = normalizeManagedUser(user);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    loginId: account.loginId,
    facultyId: account.facultyId,
    role: account.role,
    status: account.status || "active",
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
    createdAt: account.createdAt,
    invitationStatus: account.invitationStatus,
    invitationDate: account.invitation ? account.invitation.invitedAt : "",
    invitationExpiresAt: account.invitation ? account.invitation.expiresAt : "",
    lastInvitationSentAt: account.invitation ? account.invitation.lastSentAt : "",
    lastLoginAt: account.lastLoginAt || ""
  };
}

function mapNotice(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    content: item.content,
    publishedAt: item.publishedAt,
    authorName: item.authorName
  };
}

function getDefaultNewsEventsCards() {
  return [
    {
      id: createId("announcement"),
      kind: "announcement",
      date: "8 Apr 2026",
      title: "Seminar on Quantum Computing by Prof. A. Das, April 15, 2026"
    },
    {
      id: createId("announcement"),
      kind: "announcement",
      date: "5 Apr 2026",
      title: "Call for Applications: Summer Research Fellowship 2026"
    },
    {
      id: createId("announcement"),
      kind: "announcement",
      date: "1 Apr 2026",
      title: "Notice: Department Library will remain closed on April 14 (Ambedkar Jayanti)"
    },
    {
      id: createId("announcement"),
      kind: "announcement",
      date: "28 Mar 2026",
      title: "PhD Comprehensive Viva schedule released for Spring 2026"
    },
    {
      id: createId("announcement"),
      kind: "announcement",
      date: "20 Mar 2026",
      title: "Seminar: Topological Insulators, Prof. S. Banerjee, April 3"
    },
    {
      id: createId("event"),
      kind: "event",
      bucket: "upcoming",
      category: "seminars",
      title: "Colloquium: Dark Matter Searches at the LHC",
      date: "18 Apr 2026",
      location: "Seminar Hall, Department of Physics",
      summary: "Prof. R. Sharma from TIFR will discuss recent results from ATLAS and CMS experiments.",
      details: "This colloquium covers recent dark matter search outcomes from ATLAS and CMS experiments at CERN.",
      actionLabel: "Details"
    },
    {
      id: createId("event"),
      kind: "event",
      bucket: "upcoming",
      category: "workshops",
      title: "Workshop on Computational Physics Methods",
      date: "22 Apr 2026 - 24 Apr 2026",
      location: "Computer Lab, Physics Building",
      summary: "Three-day hands-on workshop covering Monte Carlo simulations, DFT, and molecular dynamics.",
      details: "Participants will receive practical training on modern computational techniques in physics.",
      actionLabel: "Details"
    },
    {
      id: createId("event"),
      kind: "event",
      bucket: "upcoming",
      category: "conferences",
      title: "International Conference on Condensed Matter Physics (ICCMP 2026)",
      date: "10 May 2026 - 13 May 2026",
      location: "Netaji Auditorium, IIT Kharagpur",
      summary: "Annual conference featuring invited talks, poster sessions, and panel discussions on recent advances.",
      details: "ICCMP 2026 brings together researchers and students to discuss advances in condensed matter physics.",
      actionLabel: "Details"
    },
    {
      id: createId("event"),
      kind: "event",
      bucket: "upcoming",
      category: "seminars",
      title: "Seminar: Gravitational Wave Astronomy",
      date: "2 May 2026",
      location: "Room 204, Physics Building",
      summary: "Dr. P. Mukherjee presents recent findings from LIGO-India collaboration.",
      details: "The seminar presents developments in gravitational wave observation and related instrumentation.",
      actionLabel: "Details"
    },
    {
      id: createId("event"),
      kind: "event",
      bucket: "past",
      category: "conferences",
      title: "National Symposium on Photonics",
      date: "14 Feb 2026 - 16 Feb 2026",
      location: "",
      summary: "",
      details: "National Symposium on Photonics concluded with invited talks and poster sessions.",
      actionLabel: "Details"
    },
    {
      id: createId("event"),
      kind: "event",
      bucket: "past",
      category: "seminars",
      title: "Seminar: Advances in Spintronics",
      date: "22 Jan 2026",
      location: "",
      summary: "",
      details: "This seminar covered progress in spintronic materials and device engineering.",
      actionLabel: "Details"
    }
  ];
}

function normalizeNewsEventCard(item, index) {
  const kind = String((item && item.kind) || "event").trim().toLowerCase();
  if (kind === "announcement") {
    return {
      id: String((item && item.id) || createId("announcement")).trim(),
      kind: "announcement",
      date: String((item && item.date) || "").trim(),
      title: String((item && item.title) || "").trim()
    };
  }
  return {
    id: String((item && item.id) || createId("event")).trim(),
    kind: "event",
    bucket: String((item && item.bucket) || "upcoming").trim().toLowerCase() === "past" ? "past" : "upcoming",
    category: String((item && item.category) || "seminars").trim().toLowerCase(),
    title: String((item && item.title) || `Event ${index + 1}`).trim(),
    date: String((item && item.date) || "").trim(),
    location: String((item && item.location) || "").trim(),
    summary: String((item && item.summary) || "").trim(),
    details: String((item && item.details) || "").trim(),
    actionLabel: String((item && item.actionLabel) || "Details").trim()
  };
}

function getNewsEventsPage(siteStore) {
  let page = (siteStore.content.pages || []).find((item) => item && item.id === "page-news-events");
  if (!page) {
    page = {
      id: "page-news-events",
      route: "/news-events.html",
      title: "News & Events",
      status: "published",
      summary: "Department announcements and events.",
      draft: "Department announcements and events.",
      sections: [{ id: "news-events-overview", title: "News & Events Overview", subtitle: "Editable content", content: "Department announcements and events.", image: "" }],
      media: [],
      peopleGroups: [],
      cards: getDefaultNewsEventsCards()
    };
    siteStore.content.pages.push(page);
  }
  const cards = Array.isArray(page.cards) && page.cards.length ? page.cards : getDefaultNewsEventsCards();
  page.cards = cards.map(normalizeNewsEventCard);
  return page;
}

function buildNewsEventsPayload(page, portalStore = null) {
  const cards = Array.isArray(page && page.cards) ? page.cards.map(normalizeNewsEventCard) : [];
  const cardAnnouncements = cards.filter((item) => item.kind === "announcement");
  let portalNotices = [];
  if (portalStore && Array.isArray(portalStore.notices)) {
    portalNotices = portalStore.notices.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).map((notice) => {
      let dateLabel = "";
      try {
        const d = new Date(notice.publishedAt);
        if (!Number.isNaN(d.getTime())) {
          const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          dateLabel = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }
      } catch (e) {
        dateLabel = "";
      }
      return {
        id: notice.id,
        kind: "announcement",
        title: notice.title,
        date: dateLabel || (notice.publishedAt ? notice.publishedAt.slice(0, 10) : ""),
        details: notice.content,
        category: notice.category || "General"
      };
    });
  }
  return {
    page: {
      id: page.id,
      title: page.title,
      route: page.route
    },
    announcements: [...portalNotices, ...cardAnnouncements],
    upcomingEvents: cards.filter((item) => item.kind === "event" && item.bucket === "upcoming"),
    pastEvents: cards.filter((item) => item.kind === "event" && item.bucket === "past")
  };
}

function isAllowedHostOrOrigin(sourceUrl, reqHost) {
  if (!sourceUrl) return false;
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.host.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    // Matching current Host header
    if (reqHost && (host === reqHost.toLowerCase() || host === reqHost.toLowerCase().split(":")[0])) {
      return true;
    }

    // Localhost / Loopback
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
      return true;
    }

    // APP_BASE_URL
    if (APP_BASE_URL) {
      try {
        const appUrl = new URL(APP_BASE_URL);
        if (host === appUrl.host.toLowerCase()) return true;
      } catch (e) { }
    }

    // FRONTEND_URL
    if (FRONTEND_URL) {
      try {
        const fUrl = new URL(FRONTEND_URL);
        if (host === fUrl.host.toLowerCase()) return true;
      } catch (e) { }
    }

    // CORS_ORIGINS
    if (CORS_ORIGINS) {
      const allowed = CORS_ORIGINS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
      for (const origin of allowed) {
        try {
          const oUrl = new URL(origin);
          if (host === oUrl.host.toLowerCase()) return true;
        } catch (e) {
          if (host === origin) return true;
        }
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

function validateCsrf(req) {
  const method = req.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    return { valid: true };
  }

  const origin = req.headers["origin"];
  const referer = req.headers["referer"];
  const secFetchSite = req.headers["sec-fetch-site"];
  const reqHost = req.headers["host"];

  // 1. Cross-site fetch detected via modern browser metadata
  if (secFetchSite === "cross-site") {
    return { valid: false, message: "CSRF check failed: Cross-site request rejected." };
  }

  // 2. Validate Origin if present
  if (origin && origin !== "null") {
    if (!isAllowedHostOrOrigin(origin, reqHost)) {
      return { valid: false, message: "CSRF check failed: Unauthorized origin." };
    }
    return { valid: true };
  }

  // 3. Validate Referer if Origin is absent
  if (referer) {
    if (!isAllowedHostOrOrigin(referer, reqHost)) {
      return { valid: false, message: "CSRF check failed: Unauthorized referer." };
    }
    return { valid: true };
  }

  // 4. If neither Origin nor Referer is present:
  // Safe requests send application/json, multipart/form-data, or Authorization Bearer header
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const isSafeContentType = contentType.includes("application/json") || contentType.includes("multipart/form-data");
  if (isSafeContentType) {
    return { valid: true };
  }

  const token = getTokenFromRequest(req);
  if (token) {
    return { valid: true };
  }

  return { valid: false, message: "CSRF check failed: Missing origin or valid content-type." };
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...getCorsHeaders(req.headers.origin), ...getSecurityHeaders() });
        res.end();
        return;
      }

      const csrfResult = validateCsrf(req);
      if (!csrfResult.valid) {
        sendJson(res, 403, { message: csrfResult.message });
        return;
      }

      if (pathname === "/api/health" && req.method === "GET") {
        sendJson(res, 200, { status: "ok", uptimeSeconds: Math.round(process.uptime()), timestamp: nowIso() });
        return;
      }

      if (pathname === "/api/public/visitor-count" && req.method === "GET") {
        const count = await readVisitorCount();
        sendJson(res, 200, { count }, { "Cache-Control": "no-store" });
        return;
      }

      if (pathname === "/api/public/visitor-hit" && req.method === "POST") {
        const body = await parseBody(req);
        const sessionToken = String(body.sessionToken || "").trim();
        if (!sessionToken || sessionToken.length < 16) {
          sendJson(res, 400, { message: "Invalid session token." });
          return;
        }
        let count;
        if (visitorSessions.has(sessionToken)) {
          count = await readVisitorCount();
        } else {
          visitorSessions.add(sessionToken);
          if (visitorSessions.size > 100000) {
            const iter = visitorSessions.values();
            for (let i = 0; i < 20000; i++) {
              visitorSessions.delete(iter.next().value);
            }
          }
          count = await incrementVisitorCount();
        }
        sendJson(res, 200, { count });
        return;
      }

      if (pathname === "/api/public/notices" && req.method === "GET") {
        const portalStore = await readPortalStore();
        sendJson(
          res,
          200,
          { notices: portalStore.notices.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).map(mapNotice) },
          { "Cache-Control": "no-cache, no-store, must-revalidate" }
        );
        return;
      }

      if (pathname === "/api/public/faculty" && req.method === "GET") {
        const usersStore = await readUsers();
        const facultyStore = await readFacultyStore();
        sendJson(res, 200, { faculty: buildPublicFacultyEntries(usersStore.users, facultyStore.faculty) });
        return;
      }

      if (pathname === "/api/public/postdocs" && req.method === "GET") {
        const siteStore = await readSiteStore();
        const pageItem = siteStore.content.pages.find((item) => item.id === "page-postdocs");
        sendJson(res, 200, { page: pageItem || null, peopleGroups: pageItem && Array.isArray(pageItem.peopleGroups) ? pageItem.peopleGroups : [] });
        return;
      }

      if (pathname === "/api/public/captcha-config" && req.method === "GET") {
        sendJson(res, 200, { siteKey: TURNSTILE_SITE_KEY || "" });
        return;
      }

      if (pathname === "/api/public/site-content" && req.method === "GET") {
        const siteStore = await readSiteStore();
        sendJson(
          res,
          200,
          {
            homepage: siteStore.content.homepage,
            pages: Array.isArray(siteStore.content.pages) ? siteStore.content.pages : [],
            maintenanceMode: siteStore.settings.maintenanceMode
          },
          { "Cache-Control": "no-cache, no-store, must-revalidate" }
        );
        return;
      }

      if (pathname === "/api/public/homepage" && req.method === "GET") {
        const siteStore = await readSiteStore();
        const portalStore = await readPortalStore();
        const homepage = siteStore.content.homepage || {};
        const pages = Array.isArray(siteStore.content.pages) ? siteStore.content.pages : [];
        const homePage = pages.find((item) => item && item.id === "page-home") || null;
        sendJson(
          res,
          200,
          {
            homepage,
            cards: homePage && Array.isArray(homePage.cards) ? homePage.cards : [],
            notices: portalStore.notices.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).map(mapNotice)
          },
          { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" }
        );
        return;
      }

      if (pathname === "/api/public/news-events" && req.method === "GET") {
        const siteStore = await readSiteStore();
        const portalStore = await readPortalStore();
        const page = getNewsEventsPage(siteStore);
        sendJson(res, 200, buildNewsEventsPayload(page, portalStore), { "Cache-Control": "no-cache, no-store, must-revalidate" });
        return;
      }

      if (pathname === "/api/public/hpc-account-requests" && req.method === "POST") {
        if (isRateLimited(getRemoteIp(req) + ":hpc-account", 10, 60 * 60 * 1000)) {
          sendJson(res, 429, { message: "Too many requests. Please try again later." });
          return;
        }
        const body = await parseBody(req, 10 * 1024 * 1024);
        const name = String(body.name || "").trim();
        const department = String(body.department || "").trim();
        const email = normalizeEmail(body.email);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          sendJson(res, 400, { message: "Enter a valid email address." });
          return;
        }
        const portalStore = await readPortalStore();
        let softwareType = String(body.softwareType || "").trim();
        let softwareName = String(body.softwareName || "").trim();
        if (softwareType.includes(" - ") && !softwareName) {
          const parts = softwareType.split(" - ");
          softwareType = parts[0].trim();
          softwareName = parts.slice(1).join(" - ").trim();
        } else if (!softwareType && body.resourcesRequired) {
          const resReq = String(body.resourcesRequired).trim();
          if (resReq.includes(" - ")) {
            const parts = resReq.split(" - ");
            softwareType = parts[0].trim();
            if (!softwareName) softwareName = parts.slice(1).join(" - ").trim();
          } else {
            softwareType = resReq;
          }
        }
        const request = {
          id: createId("hpc-account"),
          name,
          department,
          preferredLoginId: String(body.preferredLoginId || "").trim(),
          instituteId: String(body.instituteId || "").trim(),
          email,
          mobile: String(body.mobile || "").trim(),
          supervisorName: String(body.supervisorName || "").trim(),
          softwareType,
          softwareName,
          mode: String(body.mode || "Serial").trim(),
          resourcesRequired: String(body.resourcesRequired || (softwareType && softwareName ? `${softwareType} - ${softwareName}` : softwareName || softwareType) || "").trim(),
          hardware: String(body.hardware || "").trim(),
          softwareLibraries: String(body.softwareLibraries || body.mode || "").trim(),
          applicantSignature: String(body.applicantSignature || "").trim(),
          date: String(body.date || "").trim(),
          supervisorSignature: String(body.supervisorSignature || "").trim(),
          inChargeSignature: String(body.inChargeSignature || "").trim(),
          serverAllotted: String(body.serverAllotted || "").trim(),
          loginIdGiven: String(body.loginIdGiven || "").trim(),
          status: "Submitted",
          createdAt: nowIso()
        };
        portalStore.hpcAccountRequests.unshift(request);
        addNotification(portalStore, {
          targetRole: "superadmin",
          title: "New HPC account form",
          message: `${name || "A visitor"} submitted an HPC account request.`,
          kind: "booking"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();

        try {
          const siteStore = await readSiteStore();
          await Promise.race([
            sendHpcRequestNotificationEmail(req, siteStore, request),
            new Promise((_, reject) => setTimeout(() => reject(new Error("HPC email notification timed out")), 8000))
          ]);
        } catch (emailError) {
          console.error("HPC notification email sending error:", emailError && emailError.message ? emailError.message : emailError);
        }

        sendJson(res, 201, { message: "HPC account form submitted successfully.", request });
        return;
      }

      const publicEventDetailsMatch = pathname.match(/^\/api\/public\/news-events\/events\/([^/]+)$/);
      if (publicEventDetailsMatch && req.method === "GET") {
        const eventId = decodeURIComponent(publicEventDetailsMatch[1]);
        const siteStore = await readSiteStore();
        const page = getNewsEventsPage(siteStore);
        const event = (page.cards || []).map(normalizeNewsEventCard).find((item) => item.kind === "event" && item.id === eventId);
        if (!event) {
          sendJson(res, 404, { message: "Event not found." });
          return;
        }
        sendJson(res, 200, { event });
        return;
      }

      if (pathname === "/api/auth/register" && req.method === "POST") {
        if (isRateLimited(getRemoteIp(req), 5, 15 * 60 * 1000)) {
          sendJson(res, 429, { message: "Too many registration attempts. Please try again later." });
          return;
        }
        const result = await registerUser(await parseBody(req));
        if (result.status !== 201 && result.status !== 200) {
          recordAttempt(getRemoteIp(req));
        }
        sendJson(res, result.status, result.body, getAuthCacheHeaders());
        return;
      }

      if (pathname === "/api/auth/login" && req.method === "POST") {
        const ip = getRemoteIp(req);
        if (isRateLimited(ip, 15, 15 * 60 * 1000)) {
          sendJson(res, 429, { message: "Too many login attempts. Please try again later." });
          return;
        }
        const body = await parseBody(req);
        const captchaResult = await verifyTurnstileToken(body.captchaToken, ip);
        if (!captchaResult.success) {
          recordAttempt(ip);
          sendJson(res, 403, { message: captchaResult.message });
          return;
        }
        const result = await loginUser(body);
        if (result.status === 200) {
          clearAttempts(ip);
        } else {
          recordAttempt(ip);
        }
        sendJson(res, result.status, result.body, getAuthCacheHeaders());
        return;
      }

      if (pathname === "/api/auth/logout" && req.method === "POST") {
        const token = getTokenFromRequest(req);
        if (!token) {
          sendJson(res, 401, { message: "Unauthorized" });
          return;
        }
        const usersStore = await readUsers();
        const user = usersStore.users.find((item) => {
          if (!Array.isArray(item.tokens)) return false;
          return item.tokens.some(t => {
            const tokenValue = typeof t === "string" ? t : (t && t.value);
            return tokenValue === token;
          });
        });
        if (!user) {
          sendJson(res, 401, { message: "Unauthorized" });
          return;
        }
        // Remove the current token and also purge any expired tokens
        user.tokens = Array.isArray(user.tokens) ? user.tokens.filter(t => {
          const tokenValue = typeof t === "string" ? t : (t && t.value);
          return tokenValue !== token;
        }) : [];
        purgeExpiredTokens(user);
        await writeUsers(usersStore);
        sendJson(res, 200, { message: "Logged out successfully." }, getAuthCacheHeaders());
        return;
      }

      if (pathname === "/api/auth/forgot-password" && req.method === "POST") {
        if (isRateLimited(getRemoteIp(req) + ":password-reset", 3, 60 * 60 * 1000)) {
          sendJson(res, 429, { message: "Too many password reset attempts. Please try again later." });
          return;
        }
        const result = await requestPasswordReset(req, await parseBody(req));
        sendJson(res, result.status, result.body);
        return;
      }

      const resetPasswordMatch = pathname.match(/^\/api\/auth\/reset-password\/([^/]+)$/);
      if (resetPasswordMatch && req.method === "GET") {
        const result = await getResetPasswordDetails(resetPasswordMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }

      if (resetPasswordMatch && req.method === "POST") {
        const result = await resetPasswordWithToken(resetPasswordMatch[1], await parseBody(req));
        sendJson(res, result.status, result.body);
        return;
      }

      const invitationMatch = pathname.match(/^\/api\/auth\/invitations\/([^/]+)$/);
      if (invitationMatch && req.method === "GET") {
        const result = await getInvitationDetails(invitationMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }

      const invitationSetupMatch = pathname.match(/^\/api\/auth\/invitations\/([^/]+)\/setup$/);
      if (invitationSetupMatch && req.method === "POST") {
        const result = await setupInvitedAdmin(invitationSetupMatch[1], await parseBody(req));
        sendJson(res, result.status, result.body);
        return;
      }

      const user = await getAuthenticatedUser(req);
      if (user) {
        user.isContentEditor = Boolean(
          user.role !== "superadmin" &&
          Array.isArray(user.permissions) &&
          user.permissions.includes("manage_content") &&
          (/^\/api\/superadmin\/content(?:\/|$)/.test(pathname) ||
            pathname === "/api/superadmin/uploads/image" ||
            pathname === "/api/superadmin/uploads/presentation" ||
            /^\/api\/admin\/people\//.test(pathname))
        );
      }

      if (pathname.startsWith("/api/") && !user && pathname !== "/api/auth/register" && pathname !== "/api/auth/login" && pathname !== "/api/auth/forgot-password" && !pathname.startsWith("/api/public/") && !pathname.match(/^\/api\/auth\/invitations\/([^/]+)(\/setup)?$/) && !pathname.match(/^\/api\/auth\/reset-password\/([^/]+)$/)) {
        sendJson(res, 401, { message: "Unauthorized" });
        return;
      }

      if (pathname === "/api/auth/me" && req.method === "GET") {
        sendJson(res, 200, { user: createPublicUser(user) }, getAuthCacheHeaders());
        return;
      }

      if (pathname === "/api/admin/hpc-account-requests" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "hpc_facility", siteStore)) {
          sendJson(res, 403, { message: "Superadmin has not granted HPC facility access for this account yet." });
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, {
          requests: portalStore.hpcAccountRequests.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        });
        return;
      }

      const hpcApproveMatch = pathname.match(/^\/api\/admin\/hpc-account-requests\/([^/]+)\/approve$/);
      if (hpcApproveMatch && (req.method === "POST" || req.method === "PATCH")) {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "hpc_facility", siteStore)) {
          sendJson(res, 403, { message: "Superadmin has not granted HPC facility access for this account yet." });
          return;
        }
        const requestId = decodeURIComponent(hpcApproveMatch[1]);
        const portalStore = await readPortalStore();
        const request = portalStore.hpcAccountRequests.find((item) => item.id === requestId);
        if (!request) {
          sendJson(res, 404, { message: "HPC account form not found." });
          return;
        }
        request.status = "Approved";
        request.approvedAt = nowIso();
        request.approvedBy = user.name || user.email || user.id;
        request.forwardedToSuperadmin = true;
        request.forwardedAt = nowIso();
        request.forwardedBy = user.name || user.email || user.id;

        addNotification(portalStore, {
          targetRole: "superadmin",
          title: "HPC Form Approved - Sent to Superadmin",
          message: `HPC form for ${request.name || "Applicant"} (${request.instituteId || "N/A"}) was approved by Admin ${user.name || user.email || ""} and sent to Superadmin.`,
          kind: "booking",
          link: `./admin-module.html?module=computational-access&title=HPC%20Facility&id=${encodeURIComponent(request.id)}`
        });

        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "HPC account form approved and sent to Superadmin successfully.", request });
        return;
      }

      const hpcAllocateMatch = pathname.match(/^\/api\/admin\/hpc-account-requests\/([^/]+)\/allocate$/);
      if (hpcAllocateMatch && (req.method === "POST" || req.method === "PATCH")) {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "hpc_facility", siteStore)) {
          sendJson(res, 403, { message: "Superadmin has not granted HPC facility access for this account yet." });
          return;
        }
        const requestId = decodeURIComponent(hpcAllocateMatch[1]);
        const portalStore = await readPortalStore();
        const request = portalStore.hpcAccountRequests.find((item) => item.id === requestId);
        if (!request) {
          sendJson(res, 404, { message: "HPC account form not found." });
          return;
        }
        const body = await parseBody(req);
        if (body.serverAllotted !== undefined) request.serverAllotted = String(body.serverAllotted || "").trim();
        if (body.loginIdGiven !== undefined) request.loginIdGiven = String(body.loginIdGiven || "").trim();
        if (body.inChargeSignature !== undefined) request.inChargeSignature = String(body.inChargeSignature || "").trim();
        request.allocatedAt = nowIso();
        request.allocatedBy = user.name || user.email || user.id;

        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "HPC allocation details updated successfully.", request });
        return;
      }

      const hpcDisagreeMatch = pathname.match(/^\/api\/admin\/hpc-account-requests\/([^/]+)\/(?:disagree|disapprove)$/);
      if (hpcDisagreeMatch && (req.method === "POST" || req.method === "PATCH")) {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "hpc_facility", siteStore)) {
          sendJson(res, 403, { message: "Superadmin has not granted HPC facility access for this account yet." });
          return;
        }
        const requestId = decodeURIComponent(hpcDisagreeMatch[1]);
        const portalStore = await readPortalStore();
        const request = portalStore.hpcAccountRequests.find((item) => item.id === requestId);
        if (!request) {
          sendJson(res, 404, { message: "HPC account form not found." });
          return;
        }
        request.status = "Disagreed";
        request.disapprovedAt = nowIso();
        request.disapprovedBy = user.name || user.email || user.id;

        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "HPC account form marked as Disagreed.", request });
        return;
      }

      const hpcDeleteMatch = pathname.match(/^\/api\/admin\/hpc-account-requests\/([^/]+)(?:\/delete)?$/);
      if (
        (hpcDeleteMatch && req.method === "DELETE") ||
        (hpcDeleteMatch && pathname.endsWith("/delete") && req.method === "POST")
      ) {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "hpc_facility", siteStore)) {
          sendJson(res, 403, { message: "Superadmin has not granted HPC facility access for this account yet." });
          return;
        }
        const requestId = decodeURIComponent(hpcDeleteMatch[1]);
        const portalStore = await readPortalStore();
        const beforeCount = portalStore.hpcAccountRequests.length;
        portalStore.hpcAccountRequests = portalStore.hpcAccountRequests.filter((item) => item.id !== requestId);
        if (portalStore.hpcAccountRequests.length === beforeCount) {
          sendJson(res, 404, { message: "HPC account form not found." });
          return;
        }
        portalStore.notifications = portalStore.notifications.filter(
          (n) => !(n.kind === "booking" && n.title === "New HPC account form" && String(n.message || "").includes(requestId))
        );
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "HPC account form permanently deleted.", id: requestId });
        return;
      }

      if (pathname === "/api/dashboard" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "view_dashboard", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const payload = user.role === "superadmin" ? await getSuperadminOverviewPayload(user) : await getDashboardPayload(user);
        sendJson(res, 200, payload);
        return;
      }

      if (pathname === "/api/dashboard/stream" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "view_dashboard", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });
        res.write(": connected\n\n");
        const client = { user, res };
        dashboardStreamClients.add(client);
        const payload = user.role === "superadmin" ? await getSuperadminOverviewPayload(user) : await getDashboardPayload(user);
        sendSseEvent(res, "dashboard", payload);
        req.on("close", () => {
          dashboardStreamClients.delete(client);
        });
        return;
      }

      if (pathname === "/api/notices" && req.method === "GET") {
        const portalStore = await readPortalStore();
        sendJson(res, 200, { notices: portalStore.notices.map(mapNotice) });
        return;
      }

      if (pathname === "/api/notices" && req.method === "POST") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "publish_notice", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const body = await parseBody(req);
        if (!String(body.title || "").trim() || !String(body.content || "").trim()) {
          sendJson(res, 400, { message: "Title and content are required." });
          return;
        }
        const portalStore = await readPortalStore();
        portalStore.notices.unshift({
          id: createId("notice"),
          title: String(body.title).trim(),
          category: String(body.category || "General").trim(),
          content: String(body.content).trim(),
          publishedAt: nowIso(),
          authorName: user.name
        });
        addNotification(portalStore, {
          targetRole: "superadmin",
          title: "New notice published",
          message: `${user.name} published "${body.title}".`,
          kind: "notice"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Notice published successfully." });
        return;
      }

      const noticeMatch = pathname.match(/^\/api\/notices\/([^/]+)$/);
      if (noticeMatch && req.method === "DELETE") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "delete_notice", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        const before = portalStore.notices.length;
        portalStore.notices = portalStore.notices.filter((item) => item.id !== noticeMatch[1]);
        if (before === portalStore.notices.length) {
          sendJson(res, 404, { message: "Notice not found." });
          return;
        }
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Notice deleted successfully." });
        return;
      }

      if (pathname === "/api/profile/me" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "edit_own_profile", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        sendJson(res, 200, { profile: await getFacultyProfileForUser(user) });
        return;
      }

      if (pathname === "/api/profile/me" && req.method === "PUT") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "edit_own_profile", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const body = await parseBody(req, 25 * 1024 * 1024);
        const facultyStore = await readFacultyStore();
        let profile = facultyStore.faculty.find((item) => isSameFacultyProfile(item, user));
        const canSelfPublishProfile = user.role === "faculty" || user.role === "admin";
        if (!profile && canSelfPublishProfile) {
          profile = createFacultyProfileFromUser(user);
          facultyStore.faculty.unshift(profile);
        }
        if (profile) {
          const profileFields = [
            "name", "designation", "phone", "office", "specialization", "department", "subgroup", "otherLinks",
            "bio", "researchInterest", "researchTeam", "researchTeamPostdocs", "researchTeamStudents",
            "publications", "coursesTaught", "industryCollaborations", "awardsAndHonors"
          ];

          profileFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
              profile[field] = String(body[field] || "").trim();
            }
          });

          if (Object.prototype.hasOwnProperty.call(body, "photoDataUrl")) {
            const photoUrl = String(body.photoDataUrl || "").trim();
            // Allow photo data URLs up to 10 MB (approx 14MB in base64 encoding)
            if (photoUrl && photoUrl.length > 14 * 1024 * 1024) {
              sendJson(res, 400, { message: "Photo exceeds maximum allowed size of 10 MB." });
              return;
            }
            profile.photoDataUrl = photoUrl;
          }

          if (Object.prototype.hasOwnProperty.call(body, "customSections")) {
            profile.customSections = normalizeCustomSections(body.customSections);
          }
          ["showCoursesTaught", "showIndustryCollaborations", "showAwardsAndHonors"].forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
              profile[field] = Boolean(body[field]);
            }
          });
          profile.email = normalizeEmail(user.email);
          profile.loginId = String(user.loginId || profile.loginId || "").trim();
          profile.facultyId = String(user.facultyId || profile.facultyId || "").trim();
        }
        // Deduplicate: remove any orphaned duplicate entries for this user that
        // may have accumulated from previous index-based auto-ID assignments.
        // Strategy: keep the first entry that matches the current user (which is
        // the `profile` we just updated), and remove any other entries that would
        // also match this user (same facultyId, loginId, or email).
        let foundCanonical = false;
        facultyStore.faculty = facultyStore.faculty.filter((item) => {
          if (!canSelfPublishProfile) {
            // For non-publishing roles, only remove bare entries with no stable ID.
            return !(
              normalizeEmail(item.email) === normalizeEmail(user.email) &&
              !String(item.facultyId || "").trim() &&
              !String(item.loginId || "").trim()
            );
          }
          if (item === profile) {
            // Always keep the canonical (just-updated) profile entry.
            foundCanonical = true;
            return true;
          }
          // Remove any other entry that resolves to the same user identity.
          if (isSameFacultyProfile(item, user)) {
            return false;
          }
          return true;
        });
        await writeFacultyStore(facultyStore);
        const usersStore = await readUsers();
        const currentUser = usersStore.users.find((item) => item.id === user.id);
        if (currentUser && body.name) {
          currentUser.name = String(body.name).trim();
          await writeUsers(usersStore);
        }
        await broadcastDashboardUpdate(user.email);
        sendJson(res, 200, { message: "Profile updated successfully.", profile: profile || createFacultyProfileFromUser({ ...user, name: body.name || user.name }) });
        return;
      }

      if (pathname === "/api/admin/administration" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const siteStore = await readSiteStore();
        const pageItem = siteStore.content.pages.find((item) => item.id === "page-administration");
        sendJson(res, 200, {
          page: pageItem || {
            id: "page-administration",
            route: "/administration.html",
            title: "Administration Page",
            status: "published",
            summary: "Administrative contacts, leadership roles, and departmental office information.",
            sections: [
              { id: "administration-overview", title: "Administration", subtitle: "Department leadership and office contacts", content: "Administrative contacts and departmental leadership information.", image: "" }
            ],
            peopleGroups: getDefaultAdministrationPeopleGroups()
          }
        });
        return;
      }

      if (pathname === "/api/admin/news-events" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!assertNewsEventsEditor(user, res, siteStore)) {
          return;
        }
        const page = getNewsEventsPage(siteStore);
        sendJson(res, 200, buildNewsEventsPayload(page));
        return;
      }

      if (pathname === "/api/admin/news-events" && req.method === "PUT") {
        const body = await parseBody(req);
        const siteStore = await readSiteStore();
        if (!assertNewsEventsEditor(user, res, siteStore)) {
          return;
        }
        const page = getNewsEventsPage(siteStore);
        if (Array.isArray(body.announcements) || Array.isArray(body.upcomingEvents) || Array.isArray(body.pastEvents)) {
          const announcements = Array.isArray(body.announcements) ? body.announcements.map((item, index) => normalizeNewsEventCard({ ...item, kind: "announcement" }, index)) : [];
          const upcomingEvents = Array.isArray(body.upcomingEvents) ? body.upcomingEvents.map((item, index) => normalizeNewsEventCard({ ...item, kind: "event", bucket: "upcoming" }, index)) : [];
          const pastEvents = Array.isArray(body.pastEvents) ? body.pastEvents.map((item, index) => normalizeNewsEventCard({ ...item, kind: "event", bucket: "past" }, index)) : [];
          page.cards = announcements.concat(upcomingEvents, pastEvents);
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "News and events updated successfully.", ...buildNewsEventsPayload(page) });
        return;
      }

      if (pathname === "/api/admin/news-events/announcements" && req.method === "POST") {
        const body = await parseBody(req);
        if (!String(body.title || "").trim()) {
          sendJson(res, 400, { message: "Announcement title is required." });
          return;
        }
        const siteStore = await readSiteStore();
        if (!assertNewsEventsEditor(user, res, siteStore)) {
          return;
        }
        const page = getNewsEventsPage(siteStore);
        const announcement = normalizeNewsEventCard({
          id: createId("announcement"),
          kind: "announcement",
          date: String(body.date || "").trim(),
          title: String(body.title || "").trim()
        }, 0);
        page.cards = [announcement].concat((page.cards || []).map(normalizeNewsEventCard));
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Announcement published successfully.", announcement });
        return;
      }

      if (pathname === "/api/admin/news-events/events" && req.method === "POST") {
        const body = await parseBody(req);
        if (!String(body.title || "").trim() || !String(body.date || "").trim()) {
          sendJson(res, 400, { message: "Event title and date are required." });
          return;
        }
        const siteStore = await readSiteStore();
        if (!assertNewsEventsEditor(user, res, siteStore)) {
          return;
        }
        const page = getNewsEventsPage(siteStore);
        const event = normalizeNewsEventCard({
          id: createId("event"),
          kind: "event",
          bucket: String(body.bucket || "upcoming"),
          category: String(body.category || "seminars"),
          title: String(body.title || "").trim(),
          date: String(body.date || "").trim(),
          location: String(body.location || "").trim(),
          summary: String(body.summary || "").trim(),
          details: String(body.details || "").trim(),
          actionLabel: "Details"
        }, 0);
        page.cards = [event].concat((page.cards || []).map(normalizeNewsEventCard));
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Event created successfully.", event });
        return;
      }

      const adminAnnouncementMatch = pathname.match(/^\/api\/admin\/news-events\/announcements\/([^/]+)$/);
      if (adminAnnouncementMatch && req.method === "DELETE") {
        const targetId = decodeURIComponent(adminAnnouncementMatch[1]);
        const siteStore = await readSiteStore();
        if (!assertNewsEventsEditor(user, res, siteStore)) {
          return;
        }
        const page = getNewsEventsPage(siteStore);
        const before = page.cards.length;
        page.cards = page.cards.filter((item) => !(item.kind === "announcement" && item.id === targetId));
        if (before === page.cards.length) {
          sendJson(res, 404, { message: "Announcement not found." });
          return;
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Announcement deleted successfully." });
        return;
      }

      const adminEventMatch = pathname.match(/^\/api\/admin\/news-events\/events\/([^/]+)$/);
      if (adminEventMatch && req.method === "DELETE") {
        const targetId = decodeURIComponent(adminEventMatch[1]);
        const siteStore = await readSiteStore();
        if (!assertNewsEventsEditor(user, res, siteStore)) {
          return;
        }
        const page = getNewsEventsPage(siteStore);
        const before = page.cards.length;
        page.cards = page.cards.filter((item) => !(item.kind === "event" && item.id === targetId));
        if (before === page.cards.length) {
          sendJson(res, 404, { message: "Event not found." });
          return;
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Event deleted successfully." });
        return;
      }

      if (pathname === "/api/admin/administration" && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const siteStore = await readSiteStore();
        let pageItem = siteStore.content.pages.find((item) => item.id === "page-administration");
        if (!pageItem) {
          pageItem = deepClone(getDefaultManagedPages().find((item) => item.id === "page-administration"));
          siteStore.content.pages.push(pageItem);
        }
        if (Object.prototype.hasOwnProperty.call(body, "summary")) {
          pageItem.summary = String(body.summary || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "title")) {
          pageItem.title = String(body.title || "").trim() || pageItem.title;
        }
        if (Array.isArray(body.peopleGroups)) {
          pageItem.peopleGroups = normalizePeopleGroups(body.peopleGroups, pageItem.peopleGroups);
        }
        pageItem.draft = Array.isArray(pageItem.peopleGroups)
          ? pageItem.peopleGroups.map((group) => {
            const heading = String(group.title || "").trim();
            const names = Array.isArray(group.items) ? group.items.map((item) => String(item.name || "").trim()).filter(Boolean).join(", ") : "";
            return [heading, names].filter(Boolean).join(": ");
          }).filter(Boolean).join("\n")
          : String(pageItem.draft || "");
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Administration page updated successfully.", page: pageItem });
        return;
      }

      const adminPeopleMatch = pathname.match(/^\/api\/admin\/people\/(administration|faculty|postdocs|students|alumni)$/);
      if (adminPeopleMatch && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const type = adminPeopleMatch[1];
        if (type === "students") {
          const siteStore = await readSiteStore();
          const pageItem = siteStore.content.pages.find((item) => item.id === "page-students");
          const fallbackPage = {
            id: "page-students",
            route: "/students.html",
            title: "Students Page",
            status: "published",
            summary: "Students of the Department of Physics.",
            sections: [
              { id: "students-overview", title: "Students", subtitle: "Students of the Department of Physics.", content: "Public student listing managed by the superadmin.", image: "" }
            ],
            peopleGroups: getDefaultStudentsPeopleGroups()
          };
          sendJson(res, 200, { type, page: pageItem || fallbackPage });
          return;
        }
        if (type === "faculty") {
          const facultyStore = await readFacultyStore();
          const siteStore = await readSiteStore();
          const pageItem = siteStore.content.pages.find((item) => item.id === "page-faculty");
          sendJson(res, 200, {
            type,
            page: pageItem || null,
            faculty: normalizeFacultyEntries(facultyStore.faculty)
          });
          return;
        }

        const siteStore = await readSiteStore();
        const pageId = type === "postdocs"
          ? "page-postdocs"
          : (type === "alumni" ? "page-graduate-students" : "page-administration");
        const fallbackPage = type === "postdocs"
          ? {
            id: "page-postdocs",
            route: "/postdocs.html",
            title: "Postdocs Page",
            status: "published",
            summary: "Postdoctoral researchers and contact details.",
            sections: [
              { id: "postdocs-directory", title: "Postdocs", subtitle: "Researchers and fellows", content: "Postdoctoral researchers associated with the department.", image: "" }
            ],
            peopleGroups: getDefaultPostdocPeopleGroups()
          }
          : type === "alumni"
            ? {
              id: "page-graduate-students",
              route: "/graduate-students.html",
              title: "Graduate Students Page",
              status: "published",
              summary: "Graduate student listing, profiles, and research-area grouping.",
              sections: [
                { id: "graduate-overview", title: "All Students", subtitle: "Student listing", content: "Graduate student listing and grouping by research area.", image: "" }
              ],
              peopleGroups: getDefaultAlumniPeopleGroups()
            }
            : {
              id: "page-administration",
              route: "/administration.html",
              title: "Administration Page",
              status: "published",
              summary: "Administrative contacts, leadership roles, and departmental office information.",
              sections: [
                { id: "administration-overview", title: "Administration", subtitle: "Department leadership and office contacts", content: "Administrative contacts and departmental leadership information.", image: "" }
              ],
              peopleGroups: getDefaultAdministrationPeopleGroups()
            };
        const pageItem = siteStore.content.pages.find((item) => item.id === pageId);
        sendJson(res, 200, { type, page: pageItem || fallbackPage });
        return;
      }

      if (adminPeopleMatch && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const type = adminPeopleMatch[1];
        const body = await parseBody(req);

        if (type === "students") {
          const siteStore = await readSiteStore();
          let pageItem = siteStore.content.pages.find((item) => item.id === "page-students");
          if (!pageItem) {
            pageItem = {
              id: "page-students",
              route: "/students.html",
              title: "Students Page",
              status: "published",
              summary: "Students of the Department of Physics.",
              sections: [
                { id: "students-overview", title: "Students", subtitle: "Students of the Department of Physics.", content: "Public student listing managed by the superadmin.", image: "" }
              ],
              peopleGroups: getDefaultStudentsPeopleGroups()
            };
            siteStore.content.pages.push(pageItem);
          }
          if (typeof body.summary === "string") {
            pageItem.summary = String(body.summary || pageItem.summary || "").trim();
          }
          if (Array.isArray(body.peopleGroups)) {
            pageItem.peopleGroups = normalizePeopleGroups(body.peopleGroups, pageItem.peopleGroups || getDefaultStudentsPeopleGroups());
          }
          if (Array.isArray(body.sections)) {
            pageItem.sections = body.sections;
          }
          await writeSiteStore(siteStore);
          sendJson(res, 200, { message: "Students page updated successfully.", page: pageItem });
          return;
        }

        if (type === "faculty") {
          const facultyStore = await readFacultyStore();
          if (Array.isArray(body.faculty)) {
            const incoming = normalizeFacultyEntries(body.faculty);
            const existingFaculty = facultyStore.faculty.slice();
            facultyStore.faculty = incoming.map((entry, index) => {
              const existing = existingFaculty.find((item) => item.facultyId === entry.facultyId || normalizeEmail(item.email) === normalizeEmail(entry.email));
              const facultyId = entry.facultyId || `FPHY${String(index + 1).padStart(3, "0")}`;
              const loginId = entry.loginId || facultyId.toLowerCase();
              const initialPassword = entry.initialPassword || (existing && existing.initialPassword) || createDefaultFacultyPassword(facultyId);
              return {
                ...deepClone(existing || {}),
                facultyId,
                loginId,
                initialPassword,
                name: entry.name,
                designation: entry.designation,
                email: entry.email,
                phone: entry.phone,
                office: entry.office,
                specialization: entry.specialization,
                bio: entry.bio,
                photoDataUrl: entry.photoDataUrl || (existing && existing.photoDataUrl) || "",
                department: entry.department,
                subgroup: entry.subgroup,
                researchInterest: entry.researchInterest,
                researchTeam: entry.researchTeam,
                researchTeamPostdocs: entry.researchTeamPostdocs,
                researchTeamStudents: entry.researchTeamStudents,
                publications: entry.publications,
                coursesTaught: entry.coursesTaught,
                industryCollaborations: entry.industryCollaborations,
                awardsAndHonors: entry.awardsAndHonors,
                showCoursesTaught: entry.showCoursesTaught,
                showIndustryCollaborations: entry.showIndustryCollaborations,
                showAwardsAndHonors: entry.showAwardsAndHonors,
                otherLinks: entry.otherLinks,
                researchCluster: entry.researchCluster || "",
                customSections: normalizeCustomSections(entry.customSections)
              };
            });
            await writeFacultyStore(facultyStore);

            const usersStore = await readUsers();
            const siteStore = await readSiteStore();
            const incomingKeys = new Set(facultyStore.faculty.map((item) => `${item.facultyId}::${normalizeEmail(item.email)}`));

            usersStore.users = usersStore.users.filter((item) => {
              if (item.role !== "faculty") {
                return true;
              }
              const matchesExistingFaculty = item.facultyId || item.email
                ? existingFaculty.some((faculty) => faculty.facultyId === item.facultyId || normalizeEmail(faculty.email) === normalizeEmail(item.email))
                : false;
              if (!matchesExistingFaculty) {
                return true;
              }
              return incomingKeys.has(`${item.facultyId || ""}::${normalizeEmail(item.email)}`);
            });

            facultyStore.faculty.forEach((entry) => {
              const existingUser = usersStore.users.find((item) => item.role === "faculty" && (item.facultyId === entry.facultyId || normalizeEmail(item.email) === normalizeEmail(entry.email) || normalizeCredential(item.loginId) === normalizeCredential(entry.loginId)));
              if (existingUser) {
                existingUser.name = entry.name;
                existingUser.email = entry.email;
                existingUser.facultyId = entry.facultyId;
                existingUser.loginId = entry.loginId;
                if (!Array.isArray(existingUser.permissions) || !existingUser.permissions.length) {
                  existingUser.permissions = deepClone(siteStore.settings.rolePermissions.faculty || []);
                }
                if (!existingUser.status) {
                  existingUser.status = "active";
                }
                return;
              }

              const salt = crypto.randomBytes(16).toString("hex");
              usersStore.users.push({
                id: crypto.randomUUID(),
                role: "faculty",
                status: "active",
                facultyId: entry.facultyId,
                loginId: entry.loginId,
                name: entry.name,
                email: entry.email,
                permissions: deepClone(siteStore.settings.rolePermissions.faculty || []),
                salt,
                passwordHash: hashPassword(entry.initialPassword || createDefaultFacultyPassword(entry.facultyId), salt),
                createdAt: nowIso(),
                tokens: []
              });
            });

            await writeUsers(usersStore);
          }

          const siteStore = await readSiteStore();
          const pageItem = siteStore.content.pages.find((item) => item.id === "page-faculty");
          if (pageItem && Object.prototype.hasOwnProperty.call(body, "summary")) {
            pageItem.summary = String(body.summary || "").trim();
            await writeSiteStore(siteStore);
          }
          await broadcastDashboardUpdate();
          sendJson(res, 200, { message: "Faculty page updated successfully." });
          return;
        }

        const siteStore = await readSiteStore();
        const pageId = type === "postdocs"
          ? "page-postdocs"
          : (type === "alumni" ? "page-graduate-students" : "page-administration");
        let pageItem = siteStore.content.pages.find((item) => item.id === pageId);
        if (!pageItem) {
          pageItem = deepClone(getDefaultManagedPages().find((item) => item.id === pageId));
          siteStore.content.pages.push(pageItem);
        }
        if (Object.prototype.hasOwnProperty.call(body, "summary")) {
          pageItem.summary = String(body.summary || "").trim();
        }
        if (Array.isArray(body.peopleGroups)) {
          pageItem.peopleGroups = normalizePeopleGroups(body.peopleGroups, pageItem.peopleGroups);
        }
        pageItem.draft = Array.isArray(pageItem.peopleGroups)
          ? pageItem.peopleGroups.map((group) => {
            const heading = String(group.title || "").trim();
            const names = Array.isArray(group.items) ? group.items.map((item) => String(item.name || "").trim()).filter(Boolean).join(", ") : "";
            return [heading, names].filter(Boolean).join(": ");
          }).filter(Boolean).join("\n")
          : String(pageItem.draft || "");
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        const pageLabel = type === "postdocs" ? "Postdocs" : (type === "alumni" ? "Alumni" : "Administration");
        sendJson(res, 200, { message: pageLabel + " page updated successfully.", page: pageItem });
        return;
      }

      if (pathname === "/api/bookings/seminars" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, {
          resources: portalStore.bookingResources,
          blockedDates: portalStore.blockedDates,
          blockedSlots: portalStore.blockedSlots,
          requests: portalStore.seminarRequests.filter((item) => normalizeEmail(item.requesterEmail) === normalizeEmail(user.email)),
          bookings: portalStore.seminarRequests.filter((item) => item.status === "Approved"),
          bookingPrivilege: getBookingPrivilege(user)
        });
        return;
      }

      if (pathname === "/api/bookings/seminars" && req.method === "POST") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const body = await parseBody(req);
        const bookingDate = String(body.date || "").trim();
        const bookingEndDate = String(body.endDate || "").trim();
        if (bookingDate < getTodayDateString()) {
          sendJson(res, 400, { message: "Cannot book for a past date. Please select today or a future date." });
          return;
        }
        // Validate date range privilege
        if (bookingEndDate && bookingEndDate !== bookingDate) {
          const privilege = getBookingPrivilege(user);
          if (!privilege) {
            sendJson(res, 403, { message: "You do not have privilege to make multi-date bookings." });
            return;
          }
          const start = new Date(bookingDate);
          const end = new Date(bookingEndDate);
          const diffDays = Math.round((end - start) / 86400000);
          if (diffDays < 0) {
            sendJson(res, 400, { message: "End date must be on or after start date." });
            return;
          }
          if (diffDays + 1 > privilege.maxDays) {
            sendJson(res, 400, { message: `Your privilege (${privilege.label}) allows a maximum range of ${privilege.maxDays} days.` });
            return;
          }
        }
        const portalStore = await readPortalStore();
        const startTime = String(body.startTime || body.time || "").trim();
        const endTime = String(body.endTime || "").trim();
        const roomName = String(body.roomName || "").trim();
        const notes = String(body.notes || "").trim();
        if (!roomName || !bookingDate || !startTime || !endTime) {
          sendJson(res, 400, { message: "Seminar hall, date, start time, and end time are required." });
          return;
        }
        // Build list of dates to book
        const datesToBook = [];
        const rangeEnd = bookingEndDate && bookingEndDate >= bookingDate ? bookingEndDate : bookingDate;
        let cursor = new Date(bookingDate);
        const rangeEndDate = new Date(rangeEnd);
        while (cursor <= rangeEndDate) {
          const d = cursor.toISOString().slice(0, 10);
          datesToBook.push(d);
          cursor.setDate(cursor.getDate() + 1);
        }
        const createdBookings = [];
        const skippedDates = [];
        for (const d of datesToBook) {
          if (isBlockedSlot(d, startTime, portalStore)) { skippedDates.push(d); continue; }
          const conflictResult = findBookingConflict(portalStore, { type: "seminar", roomName, date: d, startTime, endTime });
          if (conflictResult.invalid) { sendJson(res, 400, { message: "Valid start and end time are required, and end time must be after start time." }); return; }
          if (conflictResult.conflict) { skippedDates.push(d); continue; }
          const request = {
            id: createId("seminar"),
            requesterName: user.name,
            requesterEmail: user.email,
            roomName,
            date: d,
            time: startTime,
            startTime,
            endTime,
            notes,
            status: "Approved",
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          portalStore.seminarRequests.unshift(request);
          createdBookings.push(d);
        }
        if (createdBookings.length === 0) {
          sendJson(res, 409, { message: "All selected dates are blocked or already booked." });
          return;
        }
        addNotification(portalStore, {
          targetRole: "superadmin",
          title: "New seminar request",
          message: `${user.name} requested ${roomName} for ${createdBookings.length} date(s) (${createdBookings[0]}${createdBookings.length > 1 ? ' to ' + createdBookings[createdBookings.length - 1] : ''}) ${startTime}-${endTime}.`,
          kind: "booking"
        });
        addNotification(portalStore, {
          targetEmail: user.email,
          title: "Seminar request submitted",
          message: `Your seminar request for ${createdBookings.length} date(s) was auto-approved.${skippedDates.length ? ' ' + skippedDates.length + ' date(s) were skipped (blocked/conflict).' : ''}`,
          kind: "booking"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(user.email);
        sendJson(res, 201, { message: `Request auto-approved for ${createdBookings.length} date(s).${skippedDates.length ? ' ' + skippedDates.length + ' date(s) skipped due to conflicts.' : ''}` });
        return;
      }

      if (pathname === "/api/bookings/facilities" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, {
          resources: portalStore.bookingResources,
          requests: portalStore.facilityBookings
        });
        return;
      }

      if (pathname === "/api/bookings/facilities" && req.method === "POST") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const body = await parseBody(req);
        const bookingDate = String(body.date || "").trim();
        if (bookingDate < getTodayDateString()) {
          sendJson(res, 400, { message: "Cannot book for a past date. Please select today or a future date." });
          return;
        }
        const portalStore = await readPortalStore();
        const startTime = String(body.startTime || body.time || "").trim();
        const endTime = String(body.endTime || "").trim();
        const facilityName = String(body.facilityName || body.roomName || "").trim();
        if (isBlockedSlot(bookingDate, startTime, portalStore)) {
          sendJson(res, 409, { message: "This date or time slot has been blocked by super admin. Booking is not allowed." });
          return;
        }
        const conflictResult = findBookingConflict(portalStore, {
          type: "facility",
          roomName: facilityName,
          date: String(body.date || "").trim(),
          startTime,
          endTime
        });
        if (conflictResult.invalid) {
          sendJson(res, 400, { message: "Valid start and end time are required, and end time must be after start time." });
          return;
        }
        if (conflictResult.conflict) {
          sendJson(res, 409, { message: "This facility is already booked for the selected date and time range." });
          return;
        }
        if (!facilityName || !body.date || !startTime || !endTime) {
          sendJson(res, 400, { message: "Facility, date, start time, and end time are required." });
          return;
        }
        const booking = {
          id: createId("facility"),
          requesterName: user.name,
          requesterEmail: user.email,
          roomName: facilityName,
          purpose: String(body.purpose || "").trim(),
          department: String(body.department || "").trim(),
          date: String(body.date).trim(),
          time: startTime,
          startTime,
          endTime,
          notes: String(body.notes || "").trim(),
          status: "Approved",
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        portalStore.facilityBookings.unshift(booking);
        addNotification(portalStore, {
          targetEmail: user.email,
          title: "Facility booking submitted",
          message: "Your facility booking was auto-approved.",
          kind: "booking"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(user.email);
        sendJson(res, 201, { message: "Facility booking auto-approved successfully." });
        return;
      }

      if (pathname === "/api/bookings/zoom" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, {
          resources: portalStore.bookingResources,
          blockedDates: portalStore.blockedDates,
          blockedSlots: portalStore.blockedSlots,
          requests: portalStore.zoomBookings.filter((item) => normalizeEmail(item.requesterEmail) === normalizeEmail(user.email)),
          bookings: portalStore.zoomBookings.filter((item) => item.status === "Approved"),
          bookingPrivilege: getBookingPrivilege(user)
        });
        return;
      }

      if (pathname === "/api/superadmin/booking-resources" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, { resources: portalStore.bookingResources });
        return;
      }

      if (pathname === "/api/superadmin/booking-resources" && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const portalStore = await readPortalStore();
        if (Array.isArray(body.seminarHalls)) {
          portalStore.bookingResources.seminarHalls = body.seminarHalls.map((item) => String(item || "").trim()).filter(Boolean);
        }
        if (Array.isArray(body.roomNumbers)) {
          portalStore.bookingResources.roomNumbers = body.roomNumbers.map((item) => String(item || "").trim()).filter(Boolean);
        }
        if (Array.isArray(body.facilityNames)) {
          portalStore.bookingResources.facilityNames = body.facilityNames.map((item) => String(item || "").trim()).filter(Boolean);
        }
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Booking resources updated successfully.", resources: portalStore.bookingResources });
        return;
      }

      if (pathname === "/api/bookings/zoom" && req.method === "POST") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const body = await parseBody(req);
        const bookingDate = String(body.date || "").trim();
        const bookingEndDate = String(body.endDate || "").trim();
        if (bookingDate < getTodayDateString()) {
          sendJson(res, 400, { message: "Cannot book for a past date. Please select today or a future date." });
          return;
        }
        // Validate date range privilege
        if (bookingEndDate && bookingEndDate !== bookingDate) {
          const privilege = getBookingPrivilege(user);
          if (!privilege) {
            sendJson(res, 403, { message: "You do not have privilege to make multi-date bookings." });
            return;
          }
          const start = new Date(bookingDate);
          const end = new Date(bookingEndDate);
          const diffDays = Math.round((end - start) / 86400000);
          if (diffDays < 0) {
            sendJson(res, 400, { message: "End date must be on or after start date." });
            return;
          }
          if (diffDays + 1 > privilege.maxDays) {
            sendJson(res, 400, { message: `Your privilege (${privilege.label}) allows a maximum range of ${privilege.maxDays} days.` });
            return;
          }
        }
        const portalStore = await readPortalStore();
        const startTime = String(body.startTime || body.time || "").trim();
        const endTime = String(body.endTime || "").trim();
        const roomTopic = String(body.topic || "").trim();
        const notes = String(body.notes || "").trim();
        if (!roomTopic || !bookingDate || !startTime || !endTime) {
          sendJson(res, 400, { message: "Room number, date, start time, and end time are required." });
          return;
        }
        // Build list of dates to book
        const datesToBook = [];
        const rangeEnd = bookingEndDate && bookingEndDate >= bookingDate ? bookingEndDate : bookingDate;
        let cursor = new Date(bookingDate);
        const rangeEndDate = new Date(rangeEnd);
        while (cursor <= rangeEndDate) {
          const d = cursor.toISOString().slice(0, 10);
          datesToBook.push(d);
          cursor.setDate(cursor.getDate() + 1);
        }
        const createdBookings = [];
        const skippedDates = [];
        for (const d of datesToBook) {
          if (isBlockedSlot(d, startTime, portalStore)) { skippedDates.push(d); continue; }
          const conflictResult = findBookingConflict(portalStore, { type: "zoom", topic: roomTopic, date: d, startTime, endTime });
          if (conflictResult.invalid) { sendJson(res, 400, { message: "Valid start and end time are required, and end time must be after start time." }); return; }
          if (conflictResult.conflict) { skippedDates.push(d); continue; }
          const request = {
            id: createId("zoom"),
            requesterName: user.name,
            requesterEmail: user.email,
            topic: roomTopic,
            date: d,
            time: startTime,
            startTime,
            endTime,
            notes,
            status: "Approved",
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          portalStore.zoomBookings.unshift(request);
          createdBookings.push(d);
        }
        if (createdBookings.length === 0) {
          sendJson(res, 409, { message: "All selected dates are blocked or already booked." });
          return;
        }
        addNotification(portalStore, {
          targetRole: "superadmin",
          title: "New room booking request",
          message: `${user.name} requested room "${roomTopic}" for ${createdBookings.length} date(s) (${createdBookings[0]}${createdBookings.length > 1 ? ' to ' + createdBookings[createdBookings.length - 1] : ''}) ${startTime}-${endTime}.`,
          kind: "booking"
        });
        addNotification(portalStore, {
          targetEmail: user.email,
          title: "Room booking submitted",
          message: `Your room booking for ${createdBookings.length} date(s) was auto-approved.${skippedDates.length ? ' ' + skippedDates.length + ' date(s) were skipped (blocked/conflict).' : ''}`,
          kind: "booking"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(user.email);
        sendJson(res, 201, { message: `Request auto-approved for ${createdBookings.length} date(s).${skippedDates.length ? ' ' + skippedDates.length + ' date(s) skipped due to conflicts.' : ''}` });
        return;
      }

      const bookingDeleteMatch = pathname.match(/^\/api\/bookings\/(zoom|seminars|seminar|facilities|facility)\/([^/]+)$/);
      if (bookingDeleteMatch && req.method === "DELETE") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "create_booking", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const bType = bookingDeleteMatch[1];
        const bookingId = bookingDeleteMatch[2];
        const portalStore = await readPortalStore();
        let collection = portalStore.zoomBookings;
        let bLabel = "Room";
        if (bType === "seminar" || bType === "seminars") {
          collection = portalStore.seminarRequests;
          bLabel = "Seminar hall";
        } else if (bType === "facility" || bType === "facilities") {
          collection = portalStore.facilityBookings;
          bLabel = "Facility";
        }
        const index = collection.findIndex((item) => item.id === bookingId);
        if (index === -1) {
          sendJson(res, 404, { message: "Booking not found." });
          return;
        }
        const booking = collection[index];
        const isOwner = normalizeEmail(booking.requesterEmail) === normalizeEmail(user.email);
        const isSuperAdmin = user.role === "superadmin";
        if (!isOwner && !isSuperAdmin) {
          sendJson(res, 403, { message: "You can only delete your own bookings." });
          return;
        }
        collection.splice(index, 1);
        const resourceName = booking.topic || booking.roomName || "room";
        addNotification(portalStore, {
          targetRole: "superadmin",
          title: `${bLabel} booking cancelled`,
          message: `${user.name} cancelled booking for "${resourceName}" on ${booking.date} (${booking.startTime || booking.time || ""}).`,
          kind: "booking"
        });
        if (!isSuperAdmin) {
          addNotification(portalStore, {
            targetEmail: user.email,
            title: `${bLabel} booking cancelled`,
            message: `Your booking for "${resourceName}" on ${booking.date} was cancelled.`,
            kind: "booking"
          });
        }
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(booking.requesterEmail);
        sendJson(res, 200, { message: "Booking deleted successfully." });
        return;
      }

      if (pathname === "/api/tickets" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "raise_ticket", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        const tickets = user.role === "superadmin"
          ? portalStore.tickets
          : portalStore.tickets.filter((item) => normalizeEmail(item.requesterEmail) === normalizeEmail(user.email));
        sendJson(res, 200, { tickets });
        return;
      }

      if (pathname === "/api/tickets" && req.method === "POST") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "raise_ticket", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const body = await parseBody(req);
        if (!String(body.subject || "").trim() || !String(body.description || "").trim()) {
          sendJson(res, 400, { message: "Subject and description are required." });
          return;
        }
        const portalStore = await readPortalStore();
        const ticket = {
          id: createId("ticket"),
          requesterName: user.name,
          requesterEmail: user.email,
          subject: String(body.subject).trim(),
          category: String(body.category || "General").trim(),
          description: String(body.description).trim(),
          status: "Pending",
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        portalStore.tickets.unshift(ticket);
        addNotification(portalStore, {
          targetRole: "superadmin",
          title: "New support ticket",
          message: `${user.name} raised ticket "${ticket.subject}".`,
          kind: "ticket"
        });
        addNotification(portalStore, {
          targetEmail: user.email,
          title: "Ticket submitted",
          message: `Your ticket "${ticket.subject}" has been created.`,
          kind: "ticket"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(user.email);
        sendJson(res, 201, { message: "Ticket raised successfully." });
        return;
      }

      const ticketStatusMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/status$/);
      if (ticketStatusMatch && req.method === "PATCH") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const portalStore = await readPortalStore();
        const ticket = portalStore.tickets.find((item) => item.id === ticketStatusMatch[1]);
        if (!ticket) {
          sendJson(res, 404, { message: "Ticket not found." });
          return;
        }
        ticket.status = String(body.status || ticket.status).trim();
        ticket.updatedAt = nowIso();
        addNotification(portalStore, {
          targetEmail: ticket.requesterEmail,
          title: "Ticket status updated",
          message: `Your ticket "${ticket.subject}" is now ${ticket.status}.`,
          kind: "ticket"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(ticket.requesterEmail);
        sendJson(res, 200, { message: "Ticket status updated successfully." });
        return;
      }

      if (pathname === "/api/notifications" && req.method === "GET") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "view_notifications", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, { notifications: getUserNotifications(portalStore, user) });
        return;
      }

      const notificationMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (notificationMatch && req.method === "POST") {
        const siteStore = await readSiteStore();
        if (!hasPermission(user, "view_notifications", siteStore)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const portalStore = await readPortalStore();
        const notification = portalStore.notifications.find((item) => item.id === notificationMatch[1]);
        if (!notification) {
          sendJson(res, 404, { message: "Notification not found." });
          return;
        }
        const userKey = normalizeEmail(user.email);
        if (!notification.readBy.includes(userKey)) {
          notification.readBy.push(userKey);
          await writePortalStore(portalStore);
        }
        await broadcastDashboardUpdate(user.email);
        sendJson(res, 200, { message: "Notification marked as read." });
        return;
      }

      if (pathname === "/api/support/conversations" && req.method === "GET") {
        if (!user || (user.role !== "faculty" && user.role !== "admin" && user.role !== "superadmin")) {
          sendJson(res, 403, { message: "Faculty/Admin or Super Admin access required." });
          return;
        }
        const portalStore = await readPortalStore();
        if (user.role === "superadmin") {
          const usersStore = await readUsers();
          const facultyStore = await readFacultyStore();
          const conversations = portalStore.supportConversations
            .slice()
            .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
            .map((item) => {
              const summary = mapConversationSummary(item);
              const adminProfile = getAdminProfileDetailsFromStores(item, usersStore, facultyStore);
              return { ...summary, adminProfile };
            });
          sendJson(res, 200, { role: "superadmin", conversations });
          return;
        }

        const usersStore = await readUsers();
        const superadminUser = usersStore.users.find((item) => item.role === "superadmin") || null;
        const conversation = findOrCreateSupportConversation(portalStore, user);
        await writePortalStore(portalStore);
        sendJson(res, 200, {
          role: "admin",
          conversation,
          superadmin: superadminUser ? { name: superadminUser.name, email: superadminUser.email } : null
        });
        return;
      }

      const supportConversationMatch = pathname.match(/^\/api\/support\/conversations\/([^/]+)$/);
      if (supportConversationMatch && req.method === "GET") {
        if (!user || (user.role !== "faculty" && user.role !== "admin" && user.role !== "superadmin")) {
          sendJson(res, 403, { message: "Faculty/Admin or Super Admin access required." });
          return;
        }
        const portalStore = await readPortalStore();
        const conversation = portalStore.supportConversations.find((item) => item.id === supportConversationMatch[1]);
        if (!conversation) {
          sendJson(res, 404, { message: "Conversation not found." });
          return;
        }
        if (user.role !== "superadmin" && normalizeEmail(conversation.adminEmail) !== normalizeEmail(user.email)) {
          sendJson(res, 403, { message: "Permission denied." });
          return;
        }
        const usersStore = await readUsers();
        const facultyStore = await readFacultyStore();
        const adminProfile = getAdminProfileDetailsFromStores(conversation, usersStore, facultyStore);
        sendJson(res, 200, { conversation, adminProfile });
        return;
      }

      if (pathname === "/api/support/messages" && req.method === "POST") {
        if (!user || (user.role !== "faculty" && user.role !== "admin" && user.role !== "superadmin")) {
          sendJson(res, 403, { message: "Faculty/Admin or Super Admin access required." });
          return;
        }
        const body = await parseBody(req);
        const text = String(body.text || "").trim();
        let imageDataUrl = "";
        try {
          imageDataUrl = sanitizeSupportImageDataUrl(body.imageDataUrl);
        } catch (error) {
          sendJson(res, 400, { message: error.message });
          return;
        }
        if (!text && !imageDataUrl) {
          sendJson(res, 400, { message: "Message text or image is required." });
          return;
        }

        const portalStore = await readPortalStore();
        let conversation = null;
        if (user.role === "superadmin") {
          const conversationId = String(body.conversationId || "").trim();
          if (!conversationId) {
            sendJson(res, 400, { message: "Conversation ID is required." });
            return;
          }
          conversation = portalStore.supportConversations.find((item) => item.id === conversationId);
          if (!conversation) {
            sendJson(res, 404, { message: "Conversation not found." });
            return;
          }
        } else {
          conversation = findOrCreateSupportConversation(portalStore, user);
        }

        const message = {
          id: createId("support-message"),
          senderRole: user.role,
          senderEmail: normalizeEmail(user.email),
          senderName: String(user.name || "").trim(),
          text,
          imageDataUrl,
          createdAt: nowIso()
        };

        conversation.messages.push(message);
        conversation.updatedAt = message.createdAt;
        portalStore.supportConversations.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
        addNotification(portalStore, {
          targetRole: user.role === "superadmin" ? "admin" : "superadmin",
          targetEmail: user.role === "superadmin" ? conversation.adminEmail : "",
          title: "New support message",
          message: `${user.name} sent a support message.`,
          kind: "ticket"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Support message sent successfully.", conversationId: conversation.id });
        return;
      }

      if (pathname === "/api/faculty-credentials" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const facultyStore = await readFacultyStore();
        sendJson(res, 200, {
          faculty: facultyStore.faculty.map((item) => ({
            facultyId: item.facultyId,
            loginId: item.loginId,
            initialPassword: item.initialPassword,
            name: item.name,
            email: item.email
          }))
        });
        return;
      }

      if (pathname === "/api/superadmin/overview" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        sendJson(res, 200, await getSuperadminOverviewPayload(user));
        return;
      }

      if (pathname === "/api/superadmin/users" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const usersStore = await readUsers();
        sendJson(res, 200, { users: usersStore.users.map(mapUserForManagement) });
        return;
      }

      if (pathname === "/api/superadmin/users/invitations" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const result = await createAdminInvitation(req, await parseBody(req));
        await broadcastDashboardUpdate();
        sendJson(res, result.status, result.body);
        return;
      }

      const resendInvitationMatch = pathname.match(/^\/api\/superadmin\/users\/([^/]+)\/resend-invitation$/);
      if (resendInvitationMatch && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const result = await resendAdminInvitation(req, resendInvitationMatch[1]);
        await broadcastDashboardUpdate();
        sendJson(res, result.status, result.body);
        return;
      }

      const manageUserMatch = pathname.match(/^\/api\/superadmin\/users\/([^/]+)$/);
      if (manageUserMatch && req.method === "PATCH") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const usersStore = await readUsers();
        const siteStore = await readSiteStore();
        const target = usersStore.users.find((item) => item.id === manageUserMatch[1]);
        if (!target) {
          sendJson(res, 404, { message: "User not found." });
          return;
        }
        if (body.role) {
          target.role = String(body.role);
          if (!body.permissions) {
            target.permissions = deepClone(siteStore.settings.rolePermissions[target.role] || []);
          }
        }
        if (body.status) {
          target.status = String(body.status);
        }
        if (Array.isArray(body.permissions)) {
          target.permissions = body.permissions;
        }
        await writeUsers(usersStore);
        await broadcastDashboardUpdate(target.email);
        sendJson(res, 200, { message: "User updated successfully.", user: mapUserForManagement(target) });
        return;
      }

      if (manageUserMatch && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const userId = manageUserMatch[1];
        const usersStore = await readUsers();
        const targetIndex = usersStore.users.findIndex((item) => item.id === userId);
        if (targetIndex === -1) {
          sendJson(res, 404, { message: "User not found." });
          return;
        }
        const target = usersStore.users[targetIndex];
        if (target.id === user.id) {
          sendJson(res, 400, { message: "You cannot delete your own account." });
          return;
        }
        if (target.role === "superadmin") {
          sendJson(res, 400, { message: "Super admin account cannot be deleted here." });
          return;
        }

        usersStore.users.splice(targetIndex, 1);
        await writeUsers(usersStore);

        const facultyStore = await readFacultyStore();
        facultyStore.faculty = facultyStore.faculty.filter((item) => !isSameFacultyProfile(item, target));
        await writeFacultyStore(facultyStore);

        await broadcastDashboardUpdate(target.email);
        sendJson(res, 200, { message: "User deleted successfully." });
        return;
      }

      if (pathname === "/api/superadmin/content" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const siteStore = await readSiteStore();
        sendJson(res, 200, { content: siteStore.content }, { "Cache-Control": "no-cache, no-store, must-revalidate" });
        return;
      }

      if (pathname === "/api/superadmin/uploads/image" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req, 16 * 1024 * 1024);
        const uploaded = await saveUploadedImage(body);
        sendJson(res, 201, { message: "Image uploaded successfully.", imagePath: uploaded.path });
        return;
      }

      if (pathname === "/api/superadmin/uploads/presentation" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req, 26 * 1024 * 1024);
        const uploaded = await saveUploadedPresentation(body);
        sendJson(res, 201, { message: "Presentation uploaded successfully.", presentationPath: uploaded.path, upload: uploaded });
        return;
      }

      if (pathname === "/api/admin/people/alumni/upload" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req, 22 * 1024 * 1024);
        const uploaded = await saveUploadedAlumniFile(body);
        const siteStore = await readSiteStore();
        let pageItem = siteStore.content.pages.find((item) => item.id === "page-graduate-students");
        if (!pageItem) {
          pageItem = deepClone(getDefaultManagedPages().find((item) => item.id === "page-graduate-students"));
          siteStore.content.pages.push(pageItem);
        }
        const previousUploadPath = getUploadPathFromPublicPath(pageItem.alumniUpload && pageItem.alumniUpload.path);
        if (!pageItem.alumniUploadBackup && Array.isArray(pageItem.peopleGroups)) {
          pageItem.alumniUploadBackup = deepClone(pageItem.peopleGroups);
        }
        pageItem.alumniUpload = uploaded;
        if (Array.isArray(uploaded.parsedPeopleGroups) && uploaded.parsedPeopleGroups.length) {
          pageItem.peopleGroups = normalizePeopleGroups(uploaded.parsedPeopleGroups, pageItem.peopleGroups);
        }
        await writeSiteStore(siteStore);
        if (previousUploadPath && previousUploadPath !== getUploadPathFromPublicPath(uploaded.path)) {
          await fsp.unlink(previousUploadPath).catch(() => { });
        }
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Alumni file uploaded successfully.", upload: uploaded });
        return;
      }

      if (pathname === "/api/admin/people/alumni/upload" && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const siteStore = await readSiteStore();
        const pageItem = siteStore.content.pages.find((item) => item.id === "page-graduate-students");
        const uploadPath = getUploadPathFromPublicPath(pageItem && pageItem.alumniUpload && pageItem.alumniUpload.path);
        if (pageItem) {
          delete pageItem.alumniUpload;
          if (Array.isArray(pageItem.alumniUploadBackup)) {
            pageItem.peopleGroups = pageItem.alumniUploadBackup;
            delete pageItem.alumniUploadBackup;
          }
          await writeSiteStore(siteStore);
        }
        if (uploadPath) {
          await fsp.unlink(uploadPath).catch(() => { });
        }
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Alumni file deleted. Default alumni data is visible again." });
        return;
      }

      const managedPeopleUploadMatch = pathname.match(/^\/api\/admin\/people\/(postdocs|students|administration)\/upload$/);
      if (managedPeopleUploadMatch && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const type = managedPeopleUploadMatch[1];
        const body = await parseBody(req, 22 * 1024 * 1024);
        const uploaded = await saveUploadedManagedPeopleFile(body, type);
        const siteStore = await readSiteStore();
        const pageId = type === "postdocs" ? "page-postdocs" : (type === "administration" ? "page-administration" : "page-students");
        let pageItem = siteStore.content.pages.find((item) => item.id === pageId);
        if (!pageItem) {
          pageItem = deepClone(getDefaultManagedPages().find((item) => item.id === pageId) || { id: pageId, peopleGroups: [] });
          siteStore.content.pages.push(pageItem);
        }
        const previousUploadPath = getUploadPathFromPublicPath(pageItem.peopleUpload && pageItem.peopleUpload.path);
        pageItem.peopleUpload = uploaded;
        if (Array.isArray(uploaded.parsedPeopleGroups) && uploaded.parsedPeopleGroups.length) {
          if (type === "administration") {
            // Merge only the technical group; keep other admin groups (leadership, operations etc.) intact
            const techGroup = uploaded.parsedPeopleGroups.find((g) => g.id === "administration-technical");
            if (techGroup) {
              const existingGroups = Array.isArray(pageItem.peopleGroups) ? pageItem.peopleGroups : [];
              const hasTech = existingGroups.some((g) => g.id === "administration-technical");
              if (hasTech) {
                pageItem.peopleGroups = existingGroups.map((g) => g.id === "administration-technical" ? { ...g, items: techGroup.items } : g);
              } else {
                pageItem.peopleGroups = [techGroup, ...existingGroups];
              }
            }
          } else {
            pageItem.peopleGroups = normalizePeopleGroups(uploaded.parsedPeopleGroups, pageItem.peopleGroups);
          }
        }
        delete pageItem.peopleUploadBackup;
        await writeSiteStore(siteStore);
        if (previousUploadPath && previousUploadPath !== getUploadPathFromPublicPath(uploaded.path)) {
          await fsp.unlink(previousUploadPath).catch(() => { });
        }
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "People file uploaded successfully.", upload: uploaded });
        return;
      }

      if (managedPeopleUploadMatch && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const type = managedPeopleUploadMatch[1];
        const siteStore = await readSiteStore();
        const pageId = type === "postdocs" ? "page-postdocs" : (type === "administration" ? "page-administration" : "page-students");
        const pageItem = siteStore.content.pages.find((item) => item.id === pageId);
        const uploadPath = getUploadPathFromPublicPath(pageItem && pageItem.peopleUpload && pageItem.peopleUpload.path);
        if (pageItem) {
          delete pageItem.peopleUpload;
          if (type === "administration") {
            // Clear only the technical group items
            const existingGroups = Array.isArray(pageItem.peopleGroups) ? pageItem.peopleGroups : [];
            pageItem.peopleGroups = existingGroups.map((g) => g.id === "administration-technical" ? { ...g, items: [] } : g);
          } else {
            pageItem.peopleGroups = normalizePeopleGroups(
              [],
              type === "postdocs" ? getDefaultPostdocPeopleGroups() : getDefaultStudentsPeopleGroups()
            );
          }
          delete pageItem.peopleUploadBackup;
          await writeSiteStore(siteStore);
        }
        if (uploadPath) {
          await fsp.unlink(uploadPath).catch(() => { });
        }
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Uploaded people file removed." });
        return;
      }

      const postdocsGroupUploadMatch = pathname.match(/^\/api\/admin\/people\/postdocs\/upload\/(postdocs|ramunanjan)$/);
      if (postdocsGroupUploadMatch && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const subgroup = postdocsGroupUploadMatch[1];
        const groupId = subgroup === "ramunanjan" ? "ramunanjan-current" : "postdocs-current";
        const body = await parseBody(req, 22 * 1024 * 1024);
        const uploaded = await saveUploadedManagedPeopleFile(body, "postdocs");
        const siteStore = await readSiteStore();
        let pageItem = siteStore.content.pages.find((item) => item.id === "page-postdocs");
        if (!pageItem) {
          pageItem = deepClone(getDefaultManagedPages().find((item) => item.id === "page-postdocs"));
          siteStore.content.pages.push(pageItem);
        }

        const existingUploads = pageItem.peopleUploads && typeof pageItem.peopleUploads === "object" ? pageItem.peopleUploads : {};
        const previousUploadPath = getUploadPathFromPublicPath(existingUploads[subgroup] && existingUploads[subgroup].path);
        pageItem.peopleUploads = {
          ...existingUploads,
          [subgroup]: uploaded
        };

        const normalizedGroups = ensurePostdocsPeopleGroups(pageItem.peopleGroups);
        const items = pickManagedPeopleGroupItems(uploaded, groupId);
        pageItem.peopleGroups = normalizedGroups.map((group) => {
          if (group.id !== groupId) {
            return group;
          }
          return {
            ...group,
            items
          };
        });

        await writeSiteStore(siteStore);
        if (previousUploadPath && previousUploadPath !== getUploadPathFromPublicPath(uploaded.path)) {
          await fsp.unlink(previousUploadPath).catch(() => { });
        }
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "People file uploaded successfully.", upload: uploaded });
        return;
      }

      if (postdocsGroupUploadMatch && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const subgroup = postdocsGroupUploadMatch[1];
        const groupId = subgroup === "ramunanjan" ? "ramunanjan-current" : "postdocs-current";
        const siteStore = await readSiteStore();
        const pageItem = siteStore.content.pages.find((item) => item.id === "page-postdocs");
        const uploadPath = getUploadPathFromPublicPath(
          pageItem && pageItem.peopleUploads && pageItem.peopleUploads[subgroup] && pageItem.peopleUploads[subgroup].path
        );
        if (pageItem) {
          const normalizedGroups = ensurePostdocsPeopleGroups(pageItem.peopleGroups);
          pageItem.peopleGroups = normalizedGroups.map((group) => {
            if (group.id !== groupId) {
              return group;
            }
            return {
              ...group,
              items: []
            };
          });

          const existingUploads = pageItem.peopleUploads && typeof pageItem.peopleUploads === "object" ? pageItem.peopleUploads : {};
          const nextUploads = { ...existingUploads };
          delete nextUploads[subgroup];
          if (Object.keys(nextUploads).length) {
            pageItem.peopleUploads = nextUploads;
          } else {
            delete pageItem.peopleUploads;
          }
          await writeSiteStore(siteStore);
        }
        if (uploadPath) {
          await fsp.unlink(uploadPath).catch(() => { });
        }
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Uploaded people file removed." });
        return;
      }

      if (pathname === "/api/superadmin/content/homepage" && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const siteStore = await readSiteStore();
        siteStore.content.homepage.heroTitle = String(body.heroTitle || siteStore.content.homepage.heroTitle || "").trim();
        siteStore.content.homepage.heroSubtitle = String(body.heroSubtitle || siteStore.content.homepage.heroSubtitle || "").trim();
        siteStore.content.homepage.heroDescription = String(body.heroDescription || siteStore.content.homepage.heroDescription || "").trim();
        siteStore.content.homepage.heroPlacement = String(body.heroPlacement || siteStore.content.homepage.heroPlacement || "left").trim();
        siteStore.content.homepage.announcementsTitle = String(body.announcementsTitle || siteStore.content.homepage.announcementsTitle || "Announcements").trim();
        if (Array.isArray(body.heroImages)) {
          siteStore.content.homepage.heroImages = body.heroImages.map((item) => String(item || "").trim()).filter(Boolean);
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Homepage content updated successfully." });
        return;
      }

      if (pathname === "/api/superadmin/content/home-cards/create-page" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const requestedTitle = String(body.title || "").trim();
        const rawSlug = String(body.slug || "").trim();
        let requestedSlug = toManagedPageSlug(rawSlug);
        if (!requestedSlug) {
          requestedSlug = toManagedPageSlug(requestedTitle || "new-page");
        }
        if (!requestedSlug) {
          sendJson(res, 400, { message: "Card title or slug is required." });
          return;
        }
        const fileName = `${requestedSlug}.html`;
        const route = `/${fileName}`;
        const fullPath = path.join(FRONTEND_DIR, fileName);
        try {
          await fsp.access(fullPath, fs.constants.F_OK);
          sendJson(res, 409, { message: "A page with this slug already exists. Use a different title/slug." });
          return;
        } catch (error) {
          // File does not exist, safe to create.
        }

        const pageTitle = requestedTitle || toTitleCaseFromSlug(requestedSlug);
        const pageId = mapRouteToManagedPageId(route);
        const sectionId = `${requestedSlug}-overview`;
        const html = buildManagedPublicPageHtml(pageTitle, `${pageTitle} Overview`, sectionId);
        await fsp.writeFile(fullPath, html, "utf8");
        await fsp.chmod(fullPath, 0o644).catch(() => {});

        const siteStore = await readSiteStore();
        if (!siteStore.content.pages.find((item) => item.id === pageId)) {
          siteStore.content.pages.push({
            id: pageId,
            route,
            title: pageTitle,
            status: "published",
            summary: `${pageTitle} page content.`,
            draft: `${pageTitle} page content.`,
            sections: [
              {
                id: sectionId,
                title: `${pageTitle} Overview`,
                subtitle: "Editable content",
                content: `${pageTitle} page content.`,
                image: ""
              }
            ],
            media: [
              {
                id: `${sectionId}-hero-image`,
                label: "Hero Banner",
                src: "",
                alt: `${pageTitle} hero banner`
              },
              {
                id: `${sectionId}-left-image`,
                label: "Left Content Image",
                src: "",
                alt: `${pageTitle} left content image`
              },
              {
                id: `${sectionId}-right-image`,
                label: "Right Content Image",
                src: "",
                alt: `${pageTitle} right content image`
              }
            ],
            peopleGroups: []
          });
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Sub page created successfully.", pageId, route, fileName, title: pageTitle, summary: `${pageTitle} page content.` });
        return;
      }

      if (pathname === "/api/superadmin/content/home-cards/delete-page" && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const rawRoute = String(body.route || "").trim();
        const route = rawRoute
          ? (rawRoute.startsWith("./") ? rawRoute.slice(1) : (rawRoute.startsWith("/") ? rawRoute : `/${rawRoute}`))
          : "";
        if (!route || !route.endsWith(".html")) {
          sendJson(res, 400, { message: "Valid page route is required." });
          return;
        }

        const protectedRoutes = new Set([
          "/index.html",
          "/about.html",
          "/research.html",
          "/programs.html",
          "/administration.html",
          "/faculty.html",
          "/postdocs.html",
          "/contact.html",
          "/career.html",
          "/graduate-students.html"
        ]);
        if (protectedRoutes.has(route.toLowerCase())) {
          sendJson(res, 400, { message: "Default website pages cannot be deleted from this action." });
          return;
        }

        const fileName = route.replace(/^\//, "");
        if (!isPublicWebsiteHtml(fileName)) {
          sendJson(res, 400, { message: "Only public website pages can be deleted." });
          return;
        }

        const fullPath = path.join(FRONTEND_DIR, fileName);
        try {
          await fsp.access(fullPath, fs.constants.F_OK);
        } catch (error) {
          sendJson(res, 404, { message: "Page file not found." });
          return;
        }

        const siteStore = await readSiteStore();
        const pageHome = (siteStore.content.pages || []).find((item) => item && item.id === "page-home");
        if (pageHome && Array.isArray(pageHome.cards)) {
          const normalizedRouteLink = `.${route}`;
          pageHome.cards = pageHome.cards.map((card) => {
            const href = String((card && card.href) || "").trim();
            if (href === normalizedRouteLink || href === route) {
              return { ...card, href: "#" };
            }
            return card;
          });
        }

        siteStore.content.pages = (siteStore.content.pages || []).filter((item) => String(item.route || "").trim().toLowerCase() !== route.toLowerCase());
        await writeSiteStore(siteStore);
        await fsp.unlink(fullPath);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Sub page deleted successfully.", route });
        return;
      }

      const contentPageMatch = pathname.match(/^\/api\/superadmin\/content\/pages\/([^/]+)$/);
      if (contentPageMatch && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const siteStore = await readSiteStore();
        const pageItem = siteStore.content.pages.find((item) => item.id === contentPageMatch[1]);
        if (!pageItem) {
          sendJson(res, 404, { message: "Page content item not found." });
          return;
        }
        ["title", "status", "draft", "summary"].forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(body, field)) {
            pageItem[field] = String(body[field] || "").trim();
          }
        });
        if (Array.isArray(body.sections)) {
          pageItem.sections = body.sections.map((section, index) => ({
            id: String((section && section.id) || `section-${index + 1}`).trim(),
            title: String((section && section.title) || "").trim(),
            subtitle: String((section && section.subtitle) || "").trim(),
            content: String((section && section.content) || "").trim(),
            image: String((section && section.image) || "").trim(),
            youtubeLink: String((section && section.youtubeLink) || "").trim(),
            pptLink: String((section && section.pptLink) || "").trim()
          }));
        }
        if (Array.isArray(body.media)) {
          pageItem.media = body.media.map((item, index) => ({
            id: String((item && item.id) || `media-${index + 1}`).trim(),
            label: String((item && item.label) || `Image ${index + 1}`).trim(),
            src: String((item && item.src) || "").trim(),
            alt: String((item && item.alt) || "").trim()
          }));
        }
        if (Array.isArray(body.cards)) {
          pageItem.cards = body.cards.map((item, index) => ({
            id: String((item && item.id) || `card-${index + 1}`).trim(),
            title: String((item && item.title) || "").trim(),
            content: String((item && item.content) || "").trim(),
            image: String((item && item.image) || "").trim(),
            alt: String((item && item.alt) || "").trim(),
            href: String((item && item.href) || "").trim()
          }));
        }
        if (Array.isArray(body.peopleGroups)) {
          pageItem.peopleGroups = normalizePeopleGroups(body.peopleGroups, pageItem.peopleGroups);
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Page content updated successfully." });
        return;
      }

      if (pathname === "/api/superadmin/bookings" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, {
          blockedDates: portalStore.blockedDates,
          blockedSlots: portalStore.blockedSlots,
          seminarRequests: portalStore.seminarRequests,
          zoomBookings: portalStore.zoomBookings
        });
        return;
      }

      const bookingMatch = pathname.match(/^\/api\/superadmin\/bookings\/(seminar|zoom)\/([^/]+)$/);
      if (bookingMatch && req.method === "PATCH") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const portalStore = await readPortalStore();
        const collection = bookingMatch[1] === "seminar" ? portalStore.seminarRequests : portalStore.zoomBookings;
        const booking = collection.find((item) => item.id === bookingMatch[2]);
        if (!booking) {
          sendJson(res, 404, { message: "Booking request not found." });
          return;
        }
        booking.status = String(body.status || booking.status).trim();
        booking.updatedAt = nowIso();
        addNotification(portalStore, {
          targetEmail: booking.requesterEmail,
          title: "Booking status updated",
          message: `${bookingMatch[1] === "seminar" ? "Seminar" : "Zoom"} booking is now ${booking.status}.`,
          kind: "booking"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(booking.requesterEmail);
        sendJson(res, 200, { message: "Booking status updated successfully." });
        return;
      }

      if (bookingMatch && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        const collection = bookingMatch[1] === "seminar" ? portalStore.seminarRequests : portalStore.zoomBookings;
        const index = collection.findIndex((item) => item.id === bookingMatch[2]);
        if (index === -1) {
          sendJson(res, 404, { message: "Booking request not found." });
          return;
        }
        const booking = collection[index];
        collection.splice(index, 1);
        addNotification(portalStore, {
          targetEmail: booking.requesterEmail,
          title: "Booking deleted",
          message: `Your ${bookingMatch[1] === "seminar" ? "seminar" : "room"} booking for "${booking.topic || booking.roomName}" on ${booking.date} was deleted by Super Admin.`,
          kind: "booking"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(booking.requesterEmail);
        sendJson(res, 200, { message: "Booking deleted successfully." });
        return;
      }

      if (pathname === "/api/superadmin/bookings/manual" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const bookingType = String(body.type || "seminar").trim() === "zoom" ? "zoom" : "seminar";
        const date = String(body.date || "").trim();
        const time = String(body.time || "").trim();
        const title = bookingType === "zoom" ? String(body.topic || "").trim() : String(body.roomName || "").trim();
        if (!date || !time || !title) {
          sendJson(res, 400, { message: "Type, title, date, and time are required." });
          return;
        }

        const portalStore = await readPortalStore();
        if (isBlockedSlot(date, time, portalStore)) {
          sendJson(res, 409, { message: "This date or time slot is already blocked or reserved." });
          return;
        }
        if (!portalStore.blockedSlots.some((item) => item.date === date && item.time === time)) {
          portalStore.blockedSlots.unshift({
            id: createId("slot"),
            date,
            time,
            reason: String(body.reason || "Reserved by super admin").trim()
          });
        }

        const booking = createManagedBooking(portalStore, {
          type: bookingType,
          date,
          time,
          notes: String(body.notes || body.reason || "Reserved by super admin").trim(),
          requesterName: "Super Admin",
          requesterEmail: user.email,
          roomName: bookingType === "seminar" ? title : "",
          topic: bookingType === "zoom" ? title : ""
        });

        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Managed booking added and slot blocked successfully.", booking });
        return;
      }

      if (pathname === "/api/superadmin/blocked-dates" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const date = String(body.date || "").trim();
        if (!date) {
          sendJson(res, 400, { message: "Date is required." });
          return;
        }
        const portalStore = await readPortalStore();
        if (!portalStore.blockedDates.includes(date)) {
          portalStore.blockedDates.push(date);
          await writePortalStore(portalStore);
          await broadcastDashboardUpdate();
        }
        sendJson(res, 201, { message: "Blocked date added successfully." });
        return;
      }

      if (pathname === "/api/superadmin/holidays/bulk" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const inputDates = Array.isArray(body.dates) ? body.dates : [];
        const normalizedDates = inputDates
          .map((item) => String(item || "").trim())
          .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
        if (!normalizedDates.length) {
          sendJson(res, 400, { message: "Provide at least one valid date in YYYY-MM-DD format." });
          return;
        }
        const portalStore = await readPortalStore();
        const existing = new Set(portalStore.blockedDates || []);
        let added = 0;
        normalizedDates.forEach((date) => {
          if (!existing.has(date)) {
            existing.add(date);
            added += 1;
          }
        });
        portalStore.blockedDates = Array.from(existing).sort();
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: `Holiday list uploaded. ${added} new date(s) blocked.`, blockedDates: portalStore.blockedDates });
        return;
      }

      const blockedDateMatch = pathname.match(/^\/api\/superadmin\/blocked-dates\/([^/]+)$/);
      if (blockedDateMatch && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        portalStore.blockedDates = portalStore.blockedDates.filter((item) => item !== blockedDateMatch[1]);
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Blocked date removed successfully." });
        return;
      }

      if (pathname === "/api/superadmin/blocked-slots" && req.method === "POST") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const slot = {
          id: createId("slot"),
          date: String(body.date || "").trim(),
          time: String(body.time || "").trim(),
          reason: String(body.reason || "").trim()
        };
        if (!slot.date || !slot.time) {
          sendJson(res, 400, { message: "Date and time are required." });
          return;
        }
        const portalStore = await readPortalStore();
        portalStore.blockedSlots.unshift(slot);
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 201, { message: "Blocked slot added successfully." });
        return;
      }

      const blockedSlotMatch = pathname.match(/^\/api\/superadmin\/blocked-slots\/([^/]+)$/);
      if (blockedSlotMatch && req.method === "DELETE") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        portalStore.blockedSlots = portalStore.blockedSlots.filter((item) => item.id !== blockedSlotMatch[1]);
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Blocked slot removed successfully." });
        return;
      }

      if (pathname === "/api/superadmin/tickets" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, { tickets: portalStore.tickets });
        return;
      }

      if (pathname === "/api/superadmin/tickets/summary" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, {
          open: portalStore.tickets.filter((item) => item.status === "Pending").length,
          inProgress: portalStore.tickets.filter((item) => item.status === "In Progress").length,
          resolved: portalStore.tickets.filter((item) => item.status === "Resolved").length,
          total: portalStore.tickets.length
        });
        return;
      }

      const superTicketMatch = pathname.match(/^\/api\/superadmin\/tickets\/([^/]+)$/);
      if (superTicketMatch && req.method === "PATCH") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const portalStore = await readPortalStore();
        const ticket = portalStore.tickets.find((item) => item.id === superTicketMatch[1]);
        if (!ticket) {
          sendJson(res, 404, { message: "Ticket not found." });
          return;
        }
        ticket.status = String(body.status || ticket.status).trim();
        ticket.updatedAt = nowIso();
        addNotification(portalStore, {
          targetEmail: ticket.requesterEmail,
          title: "Ticket status updated",
          message: `Your ticket "${ticket.subject}" is now ${ticket.status}.`,
          kind: "ticket"
        });
        await writePortalStore(portalStore);
        await broadcastDashboardUpdate(ticket.requesterEmail);
        sendJson(res, 200, { message: "Ticket updated successfully." });
        return;
      }

      if (pathname === "/api/superadmin/notifications" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const portalStore = await readPortalStore();
        sendJson(res, 200, { notifications: getUserNotifications(portalStore, user) });
        return;
      }

      if (pathname === "/api/superadmin/settings" && req.method === "GET") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const siteStore = await readSiteStore();
        sendJson(res, 200, { settings: siteStore.settings });
        return;
      }

      if (pathname === "/api/superadmin/credentials" && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) { return; }
        const body = await parseBody(req), currentPassword = String(body.currentPassword || ""), newEmail = normalizeEmail(body.email), newPassword = String(body.password || ""), confirmPassword = String(body.confirmPassword || "");
        if (!currentPassword || !newEmail || !newPassword || !confirmPassword) { sendJson(res, 400, { message: "All credential fields are required." }); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { sendJson(res, 400, { message: "Enter a valid email address." }); return; }
        if (newPassword.length < 8) { sendJson(res, 400, { message: "The new password must be at least 8 characters long." }); return; }
        if (newPassword !== confirmPassword) { sendJson(res, 400, { message: "The new passwords do not match." }); return; }
        if (!verifyPassword(currentPassword, user)) { sendJson(res, 401, { message: "The current password is incorrect." }); return; }
        const usersStore = await readUsers();
        if (usersStore.users.find((item) => item.id !== user.id && normalizeEmail(item.email) === newEmail)) { sendJson(res, 409, { message: "That email address is already in use." }); return; }
        const managedUser = usersStore.users.find((item) => item.id === user.id), salt = crypto.randomBytes(16).toString("hex");
        managedUser.email = newEmail; managedUser.loginId = newEmail.split("@")[0]; managedUser.salt = salt; managedUser.passwordHash = hashPassword(newPassword, salt); managedUser.tokens = [];
        await writeUsers(usersStore); sendJson(res, 200, { message: "Credentials updated. Please sign in again with the new email and password." }); return;
      }
      if (pathname === "/api/superadmin/settings" && req.method === "PUT") {
        if (!assertSuperAdmin(user, res)) {
          return;
        }
        const body = await parseBody(req);
        const siteStore = await readSiteStore();
        if (Object.prototype.hasOwnProperty.call(body, "maintenanceMode")) {
          siteStore.settings.maintenanceMode = Boolean(body.maintenanceMode);
        }
        if (Object.prototype.hasOwnProperty.call(body, "maintenanceMessage")) {
          siteStore.settings.maintenanceMessage = String(body.maintenanceMessage || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "siteTitle")) {
          siteStore.settings.siteTitle = String(body.siteTitle || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "metaDescription")) {
          siteStore.settings.metaDescription = String(body.metaDescription || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "systemEmail")) {
          siteStore.settings.systemEmail = String(body.systemEmail || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "emailNotifications")) {
          siteStore.settings.emailNotifications = Boolean(body.emailNotifications);
        }
        if (Object.prototype.hasOwnProperty.call(body, "lastBackupAt")) {
          siteStore.settings.lastBackupAt = String(body.lastBackupAt || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "superadminSignupKey")) {
          siteStore.settings.superadminSignupKey = String(body.superadminSignupKey || "").trim();
        }
        if (body.rolePermissions && typeof body.rolePermissions === "object") {
          siteStore.settings.rolePermissions = {
            ...siteStore.settings.rolePermissions,
            ...body.rolePermissions
          };
          const usersStore = await readUsers();
          for (const currentUser of usersStore.users) {
            if (!Array.isArray(currentUser.permissions) || !currentUser.permissions.length || body.resetUserPermissions) {
              currentUser.permissions = deepClone(siteStore.settings.rolePermissions[currentUser.role] || []);
            }
          }
          await writeUsers(usersStore);
        }
        await writeSiteStore(siteStore);
        await broadcastDashboardUpdate();
        sendJson(res, 200, { message: "Settings updated successfully.", settings: siteStore.settings });
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { message: "API route not found." });
        return;
      }

      await serveStaticFile(req, res);
    } catch (error) {
      if (IS_PRODUCTION) {
        console.error("Unhandled request error:", error);
        sendJson(res, 500, { message: "Internal server error." });
      } else {
        sendJson(res, 500, { message: error.message || "Internal server error." });
      }
    }
  });
}

async function startServer(port = PORT) {
  await ensureStorage();
  await seedDefaultUsers();
  startPortalFileWatcher();
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

if (require.main === module) {
  startServer()
    .then(() => {
      console.log(`IIT portal server running at http://${HOST}:${PORT}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  createServer,
  startServer
};














