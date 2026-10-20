// Newsletter signup: any <form class="news" data-source="..."> posts to the studio API (/subscribe, double opt-in).
(function () {
  var API = "https://lukas-studio-api.lukas-systemized.workers.dev";
  document.querySelectorAll("form.news").forEach(function (f) {
    var msg = f.querySelector(".news-msg");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = f.querySelector("button"); btn.disabled = true; msg.textContent = "Sending…";
      fetch(API + "/subscribe", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: f.email.value, website: f.website.value, source: f.getAttribute("data-source") || "site" }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (x.j.status === "check_email") { msg.textContent = "Almost done: check your inbox and click the confirm link."; f.email.value = ""; }
          else if (x.j.status === "subscribed") msg.textContent = "You're already subscribed. Thanks!";
          else msg.textContent = x.j.message || "The newsletter opens soon. Please try again later.";
        })
        .catch(function () { msg.textContent = "Couldn't reach the server. Please try again later."; })
        .then(function () { btn.disabled = false; });
    });
  });
  if (/[?&]subscribed=1/.test(location.search)) document.querySelectorAll("form.news .news-msg").forEach(function (m) { m.textContent = "You're subscribed. Welcome! The first email is on its way."; });
})();
