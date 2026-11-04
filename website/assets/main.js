(function () {
  'use strict';

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (event) {
      if (event.target instanceof HTMLAnchorElement) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.querySelectorAll('[data-year]').forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  var copyButton = document.querySelector('[data-copy-phone]');
  var status = document.querySelector('.copy-status');

  if (copyButton && status) {
    copyButton.addEventListener('click', function () {
      var phone = copyButton.getAttribute('data-copy-phone') || '';
      var done = function (ok) {
        status.textContent = ok ? 'تم نسخ الرقم: ' + phone : 'تعذّر النسخ — الرقم: ' + phone;
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(phone).then(
          function () { done(true); },
          function () { done(false); }
        );
        return;
      }

      var input = document.createElement('textarea');
      input.value = phone;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      try {
        done(document.execCommand('copy'));
      } catch (error) {
        done(false);
      } finally {
        document.body.removeChild(input);
      }
    });
  }
})();
