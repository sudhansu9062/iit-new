"use strict";

(function () {
  var pageIndex = [
    {
      url: "./index.html",
      terms: [
        "home",
        "announcements",
        "admissions",
        "jrf",
        "exam",
        "research areas",
        "undergraduate",
        "postgraduate",
        "doctoral",
        "laboratories",
        "facilities"
      ]
    },
    {
      url: "./about.html",
      terms: [
        "about",
        "history",
        "administration",
        "head of department",
        "contact",
        "department of physics"
      ]
    },
    {
      url: "./administration.html",
      terms: ["administration", "head of department", "administrative officer", "office superintendent", "committee", "faculty in-charge"]
    },
    {
      url: "./research.html",
      terms: ["research", "research areas", "condensed matter physics", "high energy physics", "astrophysics", "cosmology", "complex systems", "active matter"]
    },
    {
      url: "./condensed-matter-physics.html",
      terms: ["condensed matter", "quantum materials", "nanostructures", "soft matter physics", "electronic transport", "spintronics", "superconductivity"]
    },
    {
      url: "./faculty.html",
      terms: ["faculty", "staff", "people", "professor", "directory"]
    },
    {
      url: "./postdocs.html",
      terms: ["postdoc", "postdocs", "postdoctoral fellow", "postdoctoral researchers", "research fellows"]
    },
    {
      url: "./graduate-students.html",
      terms: ["graduate students", "students", "phd scholars", "research scholars", "mtech students", "ms research", "integrated msc"]
    },
    {
      url: "./directory.html",
      terms: ["directory", "contacts", "phone", "email", "office", "faculty search"]
    },
    {
      url: "./contact.html",
      terms: ["contact us", "contact", "administrative contacts", "department address", "location", "send enquiry"]
    },
    {
      url: "./news-events.html",
      terms: ["news", "events", "news and events", "seminars", "workshops", "conferences", "announcements", "upcoming events", "past events"]
    },
    {
      url: "./career.html",
      terms: ["career", "careers", "opportunities", "jobs", "openings", "jrf", "postdoctoral fellow", "technical staff", "application process"]
    },
    {
      url: "./ujal-halder.html",
      terms: ["ujal halder", "profile", "publications", "research interests", "biography"]
    }
  ];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function findResult(query) {
    var q = normalize(query);
    if (!q) {
      return null;
    }

    for (var i = 0; i < pageIndex.length; i += 1) {
      var terms = pageIndex[i].terms;
      for (var j = 0; j < terms.length; j += 1) {
        var term = normalize(terms[j]);
        if (term.indexOf(q) !== -1 || q.indexOf(term) !== -1) {
          return pageIndex[i].url;
        }
      }
    }

    return null;
  }

  function onSubmit(event) {
    event.preventDefault();

    var form = event.currentTarget;
    var input = form.querySelector(".search-input");
    var query = input ? input.value : "";
    var destination = findResult(query);

    if (!destination) {
      if (input) {
        input.setCustomValidity("No matching page found. Try: home, about, faculty, directory, news, or ujal halder.");
        input.reportValidity();
        window.setTimeout(function () {
          input.setCustomValidity("");
        }, 1200);
      }
      return;
    }

    window.location.href = destination;
  }

  var searchForms = document.querySelectorAll("form.search-box");
  for (var i = 0; i < searchForms.length; i += 1) {
    searchForms[i].addEventListener("submit", onSubmit);
  }

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
