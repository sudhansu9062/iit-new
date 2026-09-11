"use strict";

(function () {
  var staticPageIndex = [
    { title: "Home", category: "Page", url: "./index.html", terms: ["home", "main", "welcome", "announcements", "department of physics", "iit kharagpur"] },
    { title: "About the Department", category: "Page", url: "./about.html", terms: ["about", "history", "mission", "overview", "head of department", "hod", "department"] },
    { title: "Faculty Members", category: "People", url: "./faculty.html", terms: ["faculty", "professors", "assistant professor", "associate professor", "teachers", "faculty members", "teaching staff"] },
    { title: "Faculty & Staff Directory", category: "People", url: "./directory.html", terms: ["directory", "contacts", "phone", "email", "office", "faculty directory", "extensions", "phone numbers"] },
    { title: "Researchers & Postdocs", category: "People", url: "./postdocs.html", terms: ["postdoc", "postdocs", "postdoctoral fellow", "postdoctoral researchers", "research fellows", "researchers"] },
    { title: "Students", category: "People", url: "./students.html", terms: ["students", "phd scholars", "research scholars", "mtech students", "msc students", "undergraduate students"] },
    { title: "Alumni & Graduates", category: "People", url: "./graduate-students.html", terms: ["alumni", "graduate students", "graduates", "phd alumni", "past students"] },
    { title: "Department Administration", category: "Administration", url: "./administration.html", terms: ["administration", "head of department", "administrative officer", "office superintendent", "committee", "faculty in-charge", "staff"] },
    { title: "Research Areas & Clusters", category: "Research", url: "./research.html", terms: ["research", "research areas", "clusters", "projects", "physics research", "publications", "laboratories"] },
    { title: "Condensed Matter Physics", category: "Research", url: "./condensed-matter-physics.html", terms: ["condensed matter", "quantum materials", "nanostructures", "soft matter", "electronic transport", "spintronics", "superconductivity", "optics", "quantum"] },
    { title: "Department Facilities", category: "Facility", url: "./facilities.html", terms: ["facilities", "facility", "experimental facilities", "laboratories", "labs", "instruments", "equipment"] },
    { title: "Facility Slot Booking", category: "Facility", url: "./facility-booking.html", terms: ["facility booking", "booking", "slot booking", "lab booking", "equipment booking", "reserve room"] },
    { title: "HPC Computing Facility", category: "Facility", url: "./hpc-facility.html", terms: ["hpc", "hpc facility", "high performance computing", "supercomputer", "computing cluster", "gpu", "nodes", "storage", "cluster"] },
    { title: "HPC Account Application", category: "Facility", url: "./hpc-account.html", terms: ["hpc account", "apply hpc", "request hpc account", "cluster access", "hpc registration"] },
    { title: "Academic Programs", category: "Programs", url: "./programs.html", terms: ["programs", "academic programs", "degrees", "curriculum", "courses", "academics"] },
    { title: "Undergraduate Program (B.Tech / B.Sc)", category: "Programs", url: "./undergraduate-program.html", terms: ["undergraduate", "btech", "b.sc", "bachelor", "ug program", "ug curriculum"] },
    { title: "Postgraduate Program (M.Tech / M.Sc)", category: "Programs", url: "./postgraduate-program.html", terms: ["postgraduate", "masters", "mtech", "msc", "pg program", "pg curriculum"] },
    { title: "Doctoral Program (Ph.D)", category: "Programs", url: "./doctoral-program.html", terms: ["doctoral", "phd", "ph.d", "doctoral program", "research scholar", "phd admissions"] },
    { title: "News & Events", category: "Events", url: "./news-events.html", terms: ["news", "events", "announcements", "seminars", "workshops", "conferences", "colloquium", "upcoming events"] },
    { title: "Career & Openings", category: "Career", url: "./career.html", terms: ["career", "careers", "opportunities", "jobs", "openings", "recruitment", "faculty positions", "vacancies"] },
    { title: "JRF & Project Positions", category: "Career", url: "./career-jrf-details.html", terms: ["jrf", "junior research fellow", "project assistant", "project positions", "research fellowship"] },
    { title: "Contact Us", category: "Contact", url: "./contact.html", terms: ["contact us", "contact", "address", "location", "email", "phone", "how to reach"] },
    { title: "Academic Calendar", category: "Events", url: "./index.html#calendar", terms: ["academic calendar", "calendar", "semester", "exams", "holidays", "dates"] },
    { title: "Admin Portal Login", category: "Portal", url: "./admin-login.html", terms: ["admin login", "faculty login", "portal login", "sign in", "admin portal"] },
    { title: "Super Admin Portal", category: "Portal", url: "./admin-login.html?role=superadmin", terms: ["super admin", "superadmin", "superadmin portal", "superadmin login"] },
    { title: "ICCMP 2026 Conference", category: "Events", url: "./iccmp-2026.html", terms: ["iccmp", "conference", "iccmp 2026", "international conference", "condensed matter physics"] },
    { title: "Transport & Travel", category: "Information", url: "./transport.html", terms: ["transport", "how to reach", "travel", "train", "airport", "directions"] },
    { title: "Sports & Recreation", category: "Information", url: "./sports.html", terms: ["sports", "recreation", "gymkhana", "facilities"] }
  ];

  var dynamicFaculty = [];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // Load faculty in background to index all professors dynamically
  try {
    fetch(window.location.origin + "/api/public/faculty", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && Array.isArray(data.faculty)) {
          dynamicFaculty = data.faculty.map(function (f) {
            var key = f.facultyId || f.loginId || f.email || "";
            return {
              title: f.name || "Faculty Member",
              desc: (f.designation ? f.designation + " | " : "") + (f.specialization || "Physics"),
              category: "Faculty",
              url: "./faculty-profile.html?id=" + encodeURIComponent(key),
              facultyName: f.name || "",
              terms: [
                f.name || "",
                f.designation || "",
                f.specialization || "",
                f.office || "",
                f.email || "",
                "faculty",
                "professor"
              ]
            };
          });
        }
      })
      .catch(function () {});
  } catch (e) {}

  function searchAll(query) {
    var q = normalize(query);
    if (!q) { return []; }
    var words = q.split(" ").filter(Boolean);
    var results = [];
    var seenUrls = {};

    function checkItem(item) {
      if (seenUrls[item.url]) { return; }
      var score = 0;
      var titleNorm = normalize(item.title);
      if (titleNorm.indexOf(q) !== -1) { score += 20; }
      if (titleNorm === q) { score += 50; }

      var allTerms = (item.terms || []).join(" ").toLowerCase();
      var allMatched = words.every(function (word) {
        return allTerms.indexOf(word) !== -1 || titleNorm.indexOf(word) !== -1;
      });

      if (allMatched) {
        score += 10;
        for (var k = 0; k < (item.terms || []).length; k++) {
          var t = normalize(item.terms[k]);
          if (t === q) { score += 30; }
          else if (t.indexOf(q) !== -1) { score += 15; }
        }
        seenUrls[item.url] = true;
        results.push({
          title: item.title,
          desc: item.desc || (item.terms ? item.terms.slice(0, 4).join(", ") : ""),
          category: item.category || "Page",
          url: item.url,
          score: score
        });
      }
    }

    // Check dynamic faculty first
    for (var f = 0; f < dynamicFaculty.length; f++) {
      checkItem(dynamicFaculty[f]);
    }

    // Check static index
    for (var i = 0; i < staticPageIndex.length; i++) {
      checkItem(staticPageIndex[i]);
    }

    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 6);
  }

  function getDropdown(form) {
    var dd = form.querySelector(".search-results-dropdown");
    if (!dd) {
      dd = document.createElement("div");
      dd.className = "search-results-dropdown";
      form.appendChild(dd);
    }
    return dd;
  }

  function renderDropdown(form, results, query) {
    var dd = getDropdown(form);
    if (!query || results.length === 0) {
      if (query && query.length >= 2) {
        dd.innerHTML = '<div class="search-no-results">No exact matches for "<b>' +
          escapeHtml(query) + '</b>".<br><a href="./faculty.html?q=' + encodeURIComponent(query) + '" style="color:#2563eb;text-decoration:underline;margin-top:6px;display:inline-block;">Search in Faculty &rarr;</a></div>';
        dd.classList.add("is-open");
      } else {
        dd.classList.remove("is-open");
        dd.innerHTML = "";
      }
      return;
    }

    var badgeClassMap = {
      "Faculty": "badge-faculty",
      "Programs": "badge-program",
      "Research": "badge-research",
      "Facility": "badge-facility"
    };

    var html = results.map(function (res) {
      var badgeClass = badgeClassMap[res.category] || "";
      return '<a class="search-result-item" href="' + escapeHtml(res.url) + '">' +
        '<span class="search-result-badge ' + badgeClass + '">' + escapeHtml(res.category) + '</span>' +
        '<div class="search-result-title">' + escapeHtml(res.title) + '</div>' +
        (res.desc ? '<div class="search-result-desc">' + escapeHtml(res.desc) + '</div>' : '') +
        '</a>';
    }).join("");

    dd.innerHTML = html;
    dd.classList.add("is-open");
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function onSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var input = form.querySelector(".search-input");
    var query = input ? input.value.trim() : "";
    if (!query) { return; }

    // If currently on faculty.html, direct filter
    var facultyInput = document.getElementById("faculty-search-input");
    if (facultyInput) {
      facultyInput.value = query;
      facultyInput.dispatchEvent(new Event("input", { bubbles: true }));
      var dd = form.querySelector(".search-results-dropdown");
      if (dd) { dd.classList.remove("is-open"); }
      return;
    }

    // If currently on directory.html, direct filter
    var dirInput = document.getElementById("directory-search-input");
    if (dirInput) {
      dirInput.value = query;
      dirInput.dispatchEvent(new Event("input", { bubbles: true }));
      var dd2 = form.querySelector(".search-results-dropdown");
      if (dd2) { dd2.classList.remove("is-open"); }
      return;
    }

    var results = searchAll(query);
    if (results.length > 0) {
      window.location.href = results[0].url;
    } else {
      window.location.href = "./faculty.html?q=" + encodeURIComponent(query);
    }
  }

  var searchForms = document.querySelectorAll("form.search-box");
  for (var i = 0; i < searchForms.length; i += 1) {
    var f = searchForms[i];
    f.addEventListener("submit", onSubmit);
    var input = f.querySelector(".search-input");
    if (input) {
      input.setAttribute("autocomplete", "off");
      input.addEventListener("input", function (e) {
        var thisForm = e.target.closest("form.search-box");
        var val = e.target.value.trim();
        // If on faculty.html, also sync table live
        var facultyInput = document.getElementById("faculty-search-input");
        if (facultyInput && facultyInput !== e.target) {
          facultyInput.value = val;
          facultyInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        var results = searchAll(val);
        renderDropdown(thisForm, results, val);
      });
      input.addEventListener("focus", function (e) {
        var thisForm = e.target.closest("form.search-box");
        var val = e.target.value.trim();
        if (val) {
          var results = searchAll(val);
          renderDropdown(thisForm, results, val);
        }
      });
    }
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-box")) {
      var allDropdowns = document.querySelectorAll(".search-results-dropdown");
      for (var d = 0; d < allDropdowns.length; d++) {
        allDropdowns[d].classList.remove("is-open");
      }
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var allDropdowns = document.querySelectorAll(".search-results-dropdown");
      for (var d = 0; d < allDropdowns.length; d++) {
        allDropdowns[d].classList.remove("is-open");
      }
    }
  });

  var navToggles = document.querySelectorAll(".nav-toggle");
  for (var k = 0; k < navToggles.length; k += 1) {
    navToggles[k].addEventListener("click", function (event) {
      var toggle = event.currentTarget;
      var nav = toggle.closest(".main-nav");
      var isOpen = nav ? nav.classList.toggle("is-open") : false;
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

      if (nav && !isOpen) {
        var openDropdowns = nav.querySelectorAll(".nav-dropdown.is-open");
        for (var m = 0; m < openDropdowns.length; m += 1) {
          openDropdowns[m].classList.remove("is-open");
        }
      }
    });
  }

  var dropdownButtons = document.querySelectorAll(".nav-dropbtn");
  for (var j = 0; j < dropdownButtons.length; j += 1) {
    dropdownButtons[j].addEventListener("click", function (event) {
      if (!window.matchMedia("(max-width: 900px)").matches) {
        return;
      }

      event.preventDefault();

      var dropdown = event.currentTarget.closest(".nav-dropdown");
      if (dropdown) {
        dropdown.classList.toggle("is-open");
      }
    });
  }

  var footerLoginToggles = document.querySelectorAll(".footer-nav-toggle");
  for (var n = 0; n < footerLoginToggles.length; n += 1) {
    footerLoginToggles[n].addEventListener("click", function (event) {
      event.preventDefault();

      var dropdown = event.currentTarget.closest(".footer-nav-dropdown");
      var isOpen = dropdown ? dropdown.classList.toggle("is-open") : false;
      event.currentTarget.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  function buildCalendarModal() {
    var modal = document.createElement("div");
    modal.className = "academic-calendar-modal";
    modal.setAttribute("hidden", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "academic-calendar-title");

    modal.innerHTML = [
      '<div class="academic-calendar-backdrop" data-calendar-close="true"></div>',
      '<div class="academic-calendar-dialog">',
      '  <div class="academic-calendar-header">',
      '    <div class="academic-calendar-title-wrap">',
      '      <span class="academic-calendar-icon" aria-hidden="true"></span>',
      '      <div>',
      '        <h2 id="academic-calendar-title">Academic Calendar</h2>',
      '        <p>Session 2026 - 2027</p>',
      "      </div>",
      "    </div>",
      '    <button type="button" class="academic-calendar-close" data-calendar-close="true" aria-label="Close">&times;</button>',
      "  </div>",
      '  <div class="academic-calendar-body">',
      "    <p>Important dates for the upcoming academic year. Please refer to the full calendar for complete details on holidays, registration windows, and convocation.</p>",
      '    <div class="academic-calendar-table-wrap">',
      '      <table class="academic-calendar-table">',
      "        <tbody>",
      "          <tr><td>21 Jul 2026</td><td>Autumn Semester Begins</td></tr>",
      "          <tr><td>06-13 Sep 2026</td><td>Mid-Semester Examinations</td></tr>",
      "          <tr><td>05 Oct 2026</td><td>Autumn Mid-Semester Break</td></tr>",
      "          <tr><td>20 Nov 2026</td><td>End of Classes (Autumn)</td></tr>",
      "          <tr><td>24 Nov-05 Dec 2026</td><td>End-Semester Examinations</td></tr>",
      "          <tr><td>05 Jan 2027</td><td>Spring Semester Begins</td></tr>",
      "          <tr><td>08-14 Mar 2027</td><td>Mid-Semester Examinations (Spring)</td></tr>",
      "        </tbody>",
      "      </table>",
      "    </div>",
      "  </div>",
      '  <div class="academic-calendar-footer">',
      '    <a class="academic-calendar-link-btn" href="./academic-calendar.png" target="_blank" rel="noopener noreferrer">View Full Calendar</a>',
      '    <a class="academic-calendar-download-btn" href="./academic-calendar.png" download="academic-calendar-2026-2027.png">Download PDF</a>',
      "  </div>",
      "</div>"
    ].join("");

    document.body.appendChild(modal);
    return modal;
  }

  var calendarModal = null;
  var calendarOpenButtons = document.querySelectorAll(".icon-calendar a");

  function closeCalendarModal() {
    if (!calendarModal) {
      return;
    }
    calendarModal.setAttribute("hidden", "");
    document.body.classList.remove("modal-open");
  }

  function openCalendarModal(event) {
    event.preventDefault();
    if (!calendarModal) {
      calendarModal = buildCalendarModal();
      calendarModal.addEventListener("click", function (clickEvent) {
        if (clickEvent.target && clickEvent.target.getAttribute("data-calendar-close") === "true") {
          closeCalendarModal();
        }
      });
    }
    calendarModal.removeAttribute("hidden");
    document.body.classList.add("modal-open");
  }

  for (var p = 0; p < calendarOpenButtons.length; p += 1) {
    calendarOpenButtons[p].addEventListener("click", openCalendarModal);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeCalendarModal();
    }
  });
})();
