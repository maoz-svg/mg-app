/* The e-mail that goes with the apartment booklets (his template, 2026-09-27), in its Hebrew
   variants: one reader or several, and for one reader a man or a woman. The body is composed as
   PLAIN TEXT - that is what he sees and edits before sending - and the HTML part is derived from
   the final text at send time, so an edit is never lost.

   English (2026-10-14): when the Harbour page is in English the flow asks compose({lang:'en'}) for
   the same letter in English (one form for everyone - English has no gendered greeting) and
   textToHtml(text, {dir:'ltr'}) for a left-to-right message. Without those options every output
   is exactly the Hebrew one it always was (the North Quarter mail uses textToHtml too).

   Loaded by harbour.html (window.MAOZ_MAIL_TEMPLATE) and by the node test
   (scripts/test-mail-template.mjs). Plain ES5 on purpose: it runs inside the old-style doc. */
(function (root) {
  'use strict';

  // the floor phrase comes from the unit code's letter, not from the strip on screen
  var FLOOR = { Y: 'בקומת הגן', I: 'בקומת הקרקע', A: 'בקומה הראשונה', B: 'בקומה השנייה', C: 'בקומה השלישית' };
  var FLOOR_EN = { Y: 'on the garden floor', I: 'on the ground floor', A: 'on the first floor', B: 'on the second floor', C: 'on the third floor' };

  // "Comfort Suite C2 בקומה השלישית", "Garden Comfort Y3 (Golden Visa) בקומת הגן";
  // lang 'en': "Comfort Suite C2 on the third floor"
  function aptLabel(code, name, lang) {
    var n = String(name || code || '').trim();
    if (code === 'Y3' && n.indexOf('Golden Visa') === -1) n += ' (Golden Visa)';
    var f = (lang === 'en' ? FLOOR_EN : FLOOR)[String(code || '').charAt(0)] || '';
    return f ? n + ' ' + f : n;
  }

  function apartmentsLines(labels) {
    var out = [labels.length > 1 ? 'מצ"ב מחשבוני השקעה + תשריטים ומפרטים טכניים של הדירות' : 'מצ"ב מחשבון השקעה + תשריט ומפרט טכני של דירה'];
    for (var i = 0; i < labels.length; i++) out.push(' \u200F' + labels[i]);
    out.push('ומצגת משקיעים של הפרויקט.');
    return out;
  }

  var BULLETS = [
    '19 יחידות דיור בוטיק - בפרויקט מנוהל לטווח קצר (דירות AIRBNB).',
    'ודאות וביטחון - רישום מלא בטאבו כולל ניהול כספים תחת חשבון נאמנות.',
    'פרויקט בלב ליבה של פיראוס, הממוקם ברחוב Kountouriotou 161, במרחק של כ-5 דקות הליכה ממרינה ZEA המפורסמת ובשדרה המרכזית Sotiros Dios המאופיינת במסחר, מסעדות ותיירות ענפה.',
    'מעטפת ליווי מלאה - שת"פ עם חברת היזמות והניהול המקומית BETA ESTATE אשר מרכזת את כלל שירותי הליווי: תכנון, בינוי, משפטי, פיננסי וניהול מלא של הנכס בשוטף.',
    'תנאי מיסוי נוחים - אמנת מס בין ישראל ליוון (מס רכישה נמוך ופטור מלא ממס שבח בעת המכירה).',
    'מודל תנאי מימון ייחודיים: חברת Loanwise - המאפשרת מימון עד 50% מעלות ההשקעה בריבית פריים + 2.5%.'
  ];

  // the same six points in English, one to one with BULLETS (his ask, 2026-10-14: "one to one with the
  // Hebrew, translated properly, in high English")
  var BULLETS_EN = [
    '19 boutique residential units - in a professionally managed short-term rental project (Airbnb apartments).',
    'Certainty and security - full registration at the Land Registry, with all funds managed through an escrow account.',
    'A project in the very heart of Piraeus, located at Kountouriotou 161, approximately a 5-minute walk from the renowned Zea Marina and from Sotiros Dios, the main boulevard, known for its commerce, restaurants and thriving tourism.',
    'Comprehensive end-to-end support - in partnership with BETA ESTATE, the local development and management company, which oversees every support service: planning, construction, legal, financial and full ongoing management of the property.',
    'Favourable tax terms - the tax treaty between Israel and Greece (low purchase tax and a full exemption from capital gains tax upon sale).',
    'A unique financing model: Loanwise, which offers financing of up to 50% of the investment cost at an interest rate of prime + 2.5%.'
  ];

  // the English letter: the Hebrew one's paragraphs, line for line; the apartments one per line with
  // two leading spaces (the HTML part indents them), no direction marks
  function composeEn(opts) {
    var names = String(opts.names || '').replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim();
    var labels = (opts.apts || []).map(function (a) { return aptLabel(a.code, a.name, 'en'); });
    var lines = [
      names ? 'Dear ' + names + ',' : 'Hello,',
      '',
      'It was a great pleasure to meet you today.',
      'Further to our meeting, please find below several key points regarding the investment in our project, "THE HARBOUR":',
      ''
    ];
    for (var i = 0; i < BULLETS_EN.length; i++) lines.push('• ' + BULLETS_EN[i]);
    lines.push('');
    lines.push('As requested,');
    lines.push(labels.length > 1
      ? 'please find attached the investment calculators + floor plans and technical specifications of the apartments'
      : 'please find attached the investment calculator + floor plan and technical specification of the apartment');
    for (var k = 0; k < labels.length; k++) lines.push('  ' + labels[k]);
    lines.push('and the project\'s investor presentation.');
    lines.push('');
    lines.push('Kind regards,');
    return {
      subject: 'Maoz Group - The Harbour Piraeus',   // the same subject in both languages
      text: lines.join('\n')
    };
  }

  /* opts: { names: 'יחיאל' | 'יחיאל ורחל', number: 's' | 'p', gender: 'm' | 'f' (singular only),
            apts: [{ code: 'C2', name: 'Comfort Suite C2' }, ...] (the one on screen first),
            lang: 'en' for the English letter (number and gender are then not used) } */
  function compose(opts) {
    if (opts && opts.lang === 'en') return composeEn(opts);
    var plural = opts.number === 'p';
    var female = !plural && opts.gender === 'f';
    var names = String(opts.names || '').replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim();
    var dear = plural ? 'היקרים' : (female ? 'היקרה' : 'היקר');
    var you = plural ? 'אתכם' : 'אותך';
    var toYou = plural ? 'לכם' : 'לך';
    var request = plural ? 'לבקשתכם' : 'לבקשתך';
    var labels = (opts.apts || []).map(function (a) { return aptLabel(a.code, a.name); });
    var lines = [
      'היי ' + (names ? names + ' ' : '') + dear + ',',
      '',
      'שמחתי מאוד לפגוש ולהכיר ' + you + ' היום.',
      'בהמשך לפגישתנו, מצרף ' + toYou + ' מספר נקודות אודות ההשקעה בפרויקט שלנו "THE HARBOUR":',
      ''
    ];
    for (var i = 0; i < BULLETS.length; i++) lines.push('• ' + BULLETS[i]);
    lines.push('');
    lines.push(request + ',');
    lines = lines.concat(apartmentsLines(labels));
    lines.push('');
    lines.push('בברכה,');
    // the signature itself is his signature card, an image (SIGNATURE_CID below); the plain-text
    // part of the mail carries SIGNATURE_TEXT in its place (his ask, 2026-09-28)
    return {
      subject: 'Maoz Group - The Harbour Piraeus',   // always this (his ask, 2026-09-27)
      text: lines.join('\n')
    };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // a Latin run (a name, an address, a street with its number, "THE HARBOUR") keeps its own
  // left-to-right order inside the right-to-left line; addresses and URLs are one run ('@', '/'),
  // and a run may hold spaces but always ends on a letter or digit. Escaping happens per piece so
  // the tags are never escaped and the entities are never split.
  var LATIN = /[A-Za-z][A-Za-z0-9@.\/:_+&'\- ]*[A-Za-z0-9\/]|[A-Za-z]/g;
  // the street is a real link to the building on Google Maps: Gmail's own guess at the address
  // linked to nothing (his report, 2026-09-27). The query was checked to land on Kountouriotou 161,
  // Pireas 185 35 (37.9411, 23.6485).
  var LINKS = { 'Kountouriotou 161': 'https://www.google.com/maps/search/?api=1&query=Kountouriotou+161,+Piraeus+185+35,+Greece' };
  function isolateLatin(raw) {
    var out = '', last = 0, m;
    LATIN.lastIndex = 0;
    while ((m = LATIN.exec(raw))) {
      var run = m[0], href = LINKS[run];
      out += esc(raw.slice(last, m.index)) + (href
        ? '<a href="' + esc(href) + '" dir="ltr" style="color:#1a73e8;text-decoration:underline">' + esc(run) + '</a>'
        : '<span dir="ltr">' + esc(run) + '</span>');
      last = m.index + run.length;
    }
    return out + esc(raw.slice(last));
  }
  // the English letter (opts.dir 'ltr') is the other way round: the line already runs left to right,
  // so a Hebrew run (a name typed in Hebrew) is the island, and the street is linked by substring -
  // in English the whole clause around it is one Latin run, so the exact-run match above never fires
  var HEB = /[֐-׿יִ-ﭏ](?:[֐-׿יִ-ﭏ0-9"'\-.,:;!? ]*[֐-׿יִ-ﭏ])?/g;
  function linkify(escaped) {
    for (var k in LINKS) {
      if (!Object.prototype.hasOwnProperty.call(LINKS, k) || escaped.indexOf(esc(k)) === -1) continue;
      escaped = escaped.split(esc(k)).join('<a href="' + esc(LINKS[k]) + '" dir="ltr" style="color:#1a73e8;text-decoration:underline">' + esc(k) + '</a>');
    }
    return escaped;
  }
  function isolateHebrew(raw) {
    var out = '', last = 0, m;
    HEB.lastIndex = 0;
    while ((m = HEB.exec(raw))) {
      out += linkify(esc(raw.slice(last, m.index))) + '<span dir="rtl">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + linkify(esc(raw.slice(last)));
  }
  var P = 'margin:0 0 14px;direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a1a';
  var P_LTR = P.replace('direction:rtl;text-align:right', 'direction:ltr;text-align:left');

  /* His signature card (assets/mail/signature.png, 1250x625 - his new card of 2026-10-04 - shown at
     460 px): attached by the main process as an INLINE image with this Content-ID - Gmail and
     Outlook show cid images in the body and block data: URIs. The same id is in electron/mail.cjs.
     The text below goes into the plain-text part, for the few clients that show no HTML. */
  var SIGNATURE_CID = 'maoz-signature@maoz-group.com';
  var SIGNATURE_TEXT = 'MAOZ GROUP\nיזמות והשקעות נדל"ן\n054-3120630\ninfo@maoz-group.com\nרחוב החושלים 5, בניין A, קומה 1 | הרצליה פיתוח';
  var SIGNATURE_ALT = 'MAOZ GROUP | יזמות והשקעות נדל"ן | 054-3120630 | info@maoz-group.com | רחוב החושלים 5, בניין A, קומה 1, הרצליה פיתוח';
  // the English mail: the same card image (there is no English card yet), English text and alt
  var SIGNATURE_TEXT_EN = 'MAOZ GROUP\nReal Estate Development & Investments\n+972 54-312-0630\ninfo@maoz-group.com\n5 HaChoshlim St., Building A, 1st Floor | Herzliya Pituach, Israel';
  var SIGNATURE_ALT_EN = 'MAOZ GROUP | Real Estate Development & Investments | +972 54-312-0630 | info@maoz-group.com | 5 HaChoshlim St., Building A, 1st Floor, Herzliya Pituach, Israel';

  // a paragraph of one short line that ends in a dash or a colon is a heading
  function isHeading(lines) {
    if (lines.length !== 1) return false;
    var t = lines[0].trim();
    return t.length <= 50 && /[-–:]$/.test(t) && !/^[•*\-]\s/.test(t);
  }

  // RTL-safe HTML for Gmail, Outlook (old and new), Apple Mail and phones: paragraphs and a
  // bullet TABLE (classic Outlook mangles right-to-left lists), every style inline.
  // opts.signatureCid: append the signature card as an inline image under the letter.
  // opts.dir 'ltr': the English letter - the same layout mirrored (<html dir="ltr" lang="en">,
  // left-aligned paragraphs, the bullet table left to right, the card on the left, English alt).
  // Without it the output is the Hebrew one, byte for byte.
  function textToHtml(text, opts) {
    var ltr = !!(opts && opts.dir === 'ltr');
    var D = ltr ? 'ltr' : 'rtl', SIDE = ltr ? 'left' : 'right', PS = ltr ? P_LTR : P, inline = ltr ? isolateHebrew : isolateLatin;
    var paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    var out = [];
    for (var i = 0; i < paras.length; i++) {
      var lines = paras[i].split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) continue;
      var allBullets = lines.every(function (l) { return /^\s*[•*\-]\s+/.test(l); });
      if (allBullets) {
        var rows = lines.map(function (l) {
          return '<tr><td dir="' + D + '" valign="top" width="18" style="padding:' + (ltr ? '0 8px 6px 0' : '0 0 6px 8px') + ';' + PS + '">•</td>' +
            '<td dir="' + D + '" align="' + SIDE + '" style="padding:0 0 6px;' + PS + '">' + inline(l.replace(/^\s*[•*\-]\s+/, '')) + '</td></tr>';
        }).join('');
        out.push('<table role="presentation" dir="' + D + '" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;direction:' + D + '">' + rows + '</table>');
      } else if (isHeading(lines)) {
        // a section heading ("אודות התוכנית -", "דגשים נוספים אודות העסקה -"): bold and underlined, the
        // trailing dash or colon dropped since the line now marks it (his ask, 2026-10-03)
        out.push('<p dir="' + D + '" style="' + PS.replace('margin:0 0 14px', 'margin:6px 0 8px') + ';font-weight:bold">' +
          '<span style="text-decoration:underline;text-underline-offset:4px">' + inline(lines[0].trim().replace(/\s*[-–:]\s*$/, '')) + '</span></p>');
      } else {
        out.push('<p dir="' + D + '" style="' + PS + '">' + lines.map(function (l) { var m = /^( +)/.exec(l); return (m ? new Array(m[1].length * 2 + 1).join('&nbsp;') : '') + inline(l.replace(/^ +/, '')); }).join('<br>') + '</p>');
      }
    }
    if (opts && opts.signatureCid) {
      out.push('<table role="presentation" dir="' + D + '" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0"><tr><td align="' + SIDE + '">' +
        '<img src="cid:' + esc(opts.signatureCid) + '" width="460" height="230" alt="' + esc(ltr ? SIGNATURE_ALT_EN : SIGNATURE_ALT) + '" ' +
        'style="display:block;width:460px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">' +
        '</td></tr></table>');
    }
    return '<!DOCTYPE html><html dir="' + D + '" lang="' + (ltr ? 'en' : 'he') + '"><head><meta charset="utf-8"><title>THE HARBOUR</title></head>' +
      '<body dir="' + D + '" style="margin:0;padding:0;background:#ffffff">' +
      '<table role="presentation" dir="' + D + '" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td dir="' + D + '" align="' + SIDE + '" style="direction:' + D + ';text-align:' + SIDE + ';padding:24px 20px">' + out.join('') + '</td></tr></table></body></html>';
  }

  var api = { FLOOR: FLOOR, FLOOR_EN: FLOOR_EN, aptLabel: aptLabel, compose: compose, textToHtml: textToHtml, SIGNATURE_CID: SIGNATURE_CID, SIGNATURE_TEXT: SIGNATURE_TEXT,
    SIGNATURE_TEXT_EN: SIGNATURE_TEXT_EN, SIGNATURE_ALT: SIGNATURE_ALT, SIGNATURE_ALT_EN: SIGNATURE_ALT_EN };
  root.MAOZ_MAIL_TEMPLATE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
