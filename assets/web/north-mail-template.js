/* The e-mail that goes with the North Quarter investor booklet (his letter, 2026-10-03), for one
   person or several and, for one, a man or a woman. Only the greeting changes: the rest is written
   from the company and addresses no one in the second person. Composed as PLAIN TEXT (what he sees
   and edits in the preview); the HTML part and the signature card come from
   harbour-mail-template.js (window.MAOZ_MAIL_TEMPLATE.textToHtml), loaded before this file.

   Copy-edits of his draft, each reversible here: "לפהקדה" -> "להפקדה"; the parcel is one (גוש 6663
   חלקה 18), so "החלקות מיועדת / נמצאת ... צפויים להנות" -> "החלקה מיועדת / נמצאת ... צפויה ליהנות";
   the "*" notes become "•" bullets; the umbrella agreement is dated 23/11/2025 (his draft said 2026,
   he confirmed 2025 on 2026-10-03). Plain ES5. */
(function (root) {
  'use strict';
  // his subject (2026-10-03). It starts with a right-to-left mark: a mail client sets a subject's
  // direction from its first strong letter, and without the mark the leading "Maoz Group" made the
  // whole line left-to-right, the Hebrew and the quotes out of order.
  var SUBJECT = '‏Maoz Group - השקעה בפרויקט "הרובע הצפוני הרצליה - שכונת המטרו"';

  function compose(opts) {
    var plural = opts.number === 'p';
    var female = !plural && opts.gender === 'f';
    var names = String(opts.names || '').replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim();
    var dear = plural ? 'היקרים' : (female ? 'היקרה' : 'היקר');
    var lines = [
      'היי ' + (names ? names + ' ' : '') + dear + ',',
      'בהמשך לפגישתנו הנעימה, מצ"ב חומרים נוספים אודות השקעה במתחם "הרובע הצפוני הרצליה - שכונת המטרו".',
      '',
      'אודות התוכנית -',
      '',
      'תמ"ל 3006 – "הרובע הצפוני הרצליה - שכונת המטרו" הינה תכנית מפורטת אשר מקודמת ע"י הותמ"ל (ועדה לתכנון ובנייה של מתחמים מועדפים לדיור) וקובעת הנחיות והוראות להקמתו של רובע עירוני חדש על שטח של כ-910 דונם בצפון הרצליה.',
      '',
      'התוכנית מובלת על ידי הותמ"ל ותוכננה על ידי משרד האדריכלים ומתכנני הערים "פרחי צפריר".',
      '',
      'התוכנית מהווה מסגרת תכנונית להקמת רובע עירוני חדש בעתודות הקרקע הצפוניות של הרצליה וכפר שמריהו, ובין היתר בתחום שדה התעופה הרצליה המתפנה - עליו אושרה תב"ע ב-2023 בשם "קריית המסלול".',
      '',
      '• בחודש מאי 2026 התכנסה ועדת התכנון ה"ותמ"ל" לצורך דיון בהפקדת התוכנית, הוחלט להפקיד את התוכנית, וכעת התוכנית נמצאת בשלב המוגדר "מילוי תנאים להפקדה".',
      '',
      'התוכנית גובלת ברחובות הבריגדה היהודית וכנפי ישרים מדרום (סמוך למרכז הבינתחומי - אוניברסיטת רייכמן), כביש 531 מצפון וכפר שמריהו / כביש 20 ממערב.',
      '',
      'הרובע החדש עתיד לכלול כ-9,640 יח"ד חדשות, כ-698,449 מ"ר של שטחי תעסוקה ומסחר, פארק רחב ידיים בדופנו המערבית של המתחם הנקשר למערכת הפארקים העירוניים מצפון ולתוכנית ההמשך של הרובע - "שכונת הפארק", עם שבילי אופניים והולכי רגל חדשים, מוסדות חינוך, פנאי ובילוי.',
      '',
      '• בתאריך 23/11/2025 פורסם כי נחתם הסכם גג בין עיריית הרצליה למדינה, הכולל בתוכו את הרובע הצפוני החדש.',
      '',
      'דגשים נוספים אודות העסקה -',
      '',
      '• גוש 6663 חלקה 18.',
      '• החלקה מיועדת בשלמות לפיתוח עירוני ומגורים - קרקע "צהובה" (לפי תמ"מ 5 - תוכנית מתאר מחוזית מאושרת) ובייעוד למגורים בבנייה רוויה לפי תוכנית המתאר הכוללנית של העיר הרצליה (הר 2530).',
      '• החלקה נמצאת בתחום רדיוס ההשפעה של תחנת המטרו "המרכז הבינתחומי" לפי תמ"א 70 המאושרת, ולכן צפויה ליהנות מאחוזי בנייה גבוהים במיוחד ביחס לחלקות אחרות בתוכנית (רח"ק) - כל תוספת הזכויות שתתקבל שייכת למשקיעי הקבוצה, ללא כל הגבלה.',
      '• כל החלקה מאוגדת בשלמות (100%) תחת הסכם שיתוף וניהול בהובלת חברת "קנדה ישראל", מה שמהווה כוח אדיר ופוזיציה חזקה אל מול השמאי ויזמי התוכנית.',
      '',
      'מצ"ב מצגת משקיעים + חוברת משקיע עם מחשבון ההשקעה הכולל צפי ואומדנים של ההשבחה, מבוסס על המצב הסטטוטורי הנוכחי בראייה שמרנית.',
      '',
      'בברכה,'
    ];
    return { subject: SUBJECT, text: lines.join('\n') };
  }

  var api = { compose: compose, SUBJECT: SUBJECT };
  root.MAOZ_NORTH_MAIL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
