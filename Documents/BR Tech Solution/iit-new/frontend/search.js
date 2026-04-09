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
      url: "./faculty.html",
      terms: ["faculty", "staff", "people", "professor", "directory"]
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
        input.setCustomValidity("No matching page found. Try: home, about, faculty, directory, ujal halder.");
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
})();
