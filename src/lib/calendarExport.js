import { format, parseISO, addHours } from 'date-fns';

// ── Buka Google Calendar add-event URL (1 event) ─────────────────
export function exportToGCal({ title, description = '', location = 'Gereja Kristus Raja Solo Baru', startDate, endDate }) {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end   = endDate
    ? (typeof endDate === 'string' ? parseISO(endDate) : endDate)
    : addHours(start, 2);

  const fmt = d => format(d, "yyyyMMdd'T'HHmmss");
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: description,
    location,
    sf: 'true',
    output: 'xml',
  });
  window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank');
}

// ── Download file .ics (banyak event, bisa diimport ke GCal/Outlook) ─
export function exportToICS(events, filename = 'jadwal-sigma.ics') {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//SIGMA//Misdinar KR Solo Baru//ID',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Jadwal SIGMA - Misdinar KR Solo Baru',
    'X-WR-TIMEZONE:Asia/Jakarta',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Jakarta',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0700', 'TZOFFSETTO:+0700',
    'TZNAME:WIB', 'DTSTART:19700101T000000', 'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const ev of events) {
    const start = typeof ev.startDate === 'string' ? parseISO(ev.startDate) : ev.startDate;
    const end   = ev.endDate
      ? (typeof ev.endDate === 'string' ? parseISO(ev.endDate) : ev.endDate)
      : addHours(start, 2);
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@sigma-krsoba`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}`,
      `DTSTART;TZID=Asia/Jakarta:${format(start, "yyyyMMdd'T'HHmmss")}`,
      `DTEND;TZID=Asia/Jakarta:${format(end, "yyyyMMdd'T'HHmmss")}`,
      `SUMMARY:${esc(ev.title)}`,
      `DESCRIPTION:${esc(ev.description || '')}`,
      `LOCATION:${esc(ev.location || 'Gereja Kristus Raja Solo Baru')}`,
      'STATUS:CONFIRMED',
      `CATEGORIES:${ev.category || 'MISDINAR'}`,
      'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY',
      `DESCRIPTION:Pengingat: ${esc(ev.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/** Konversi slot latihan misa khusus → format event */
export function slotToCalEvent(slot, sessionName) {
  const startISO = `${slot.tanggal}T${slot.waktu_mulai}`;
  const endISO   = slot.waktu_selesai ? `${slot.tanggal}T${slot.waktu_selesai}` : null;
  return {
    title: `[SIGMA] ${sessionName} — ${slot.nama_slot}`,
    description: [
      `Latihan untuk: ${sessionName}`,
      slot.is_wajib ? '⚠️ WAJIB HADIR' : 'Opsional',
      slot.keterangan || '',
    ].filter(Boolean).join('\n'),
    location: slot.lokasi || 'Gereja Kristus Raja Solo Baru',
    startDate: startISO,
    endDate: endISO,
    category: 'LATIHAN',
  };
}

/** Konversi assignment (tugas misa) → format event */
export function assignmentToCalEvent(assignment, slotInfo) {
  return {
    title: `[SIGMA] Tugas Misa — ${slotInfo.label}`,
    description: `Jadwal tugas misa sebagai misdinar.\nSlot: ${slotInfo.label}`,
    location: 'Gereja Kristus Raja Solo Baru',
    startDate: assignment.datetime,
    category: 'TUGAS MISA',
  };
}

function esc(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
}
