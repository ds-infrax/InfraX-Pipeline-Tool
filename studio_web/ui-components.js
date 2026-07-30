const UI = {
  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },

  escapeAttribute(value) {
    return UI.escapeHtml(value).replaceAll("'", "&#39;");
  },

  kv(title, body) {
    return `<div class="kv"><b>${UI.escapeHtml(title)}</b><br><span>${body}</span></div>`;
  },

  emptyKv(message) {
    return `<div class="kv"><span>${UI.escapeHtml(message)}</span></div>`;
  },

  fieldInput(label, value, onChange) {
    return `
      <div class="field">
        <label>${UI.escapeHtml(label)}</label>
        <input value="${UI.escapeAttribute(value)}" onchange="${onChange}" />
      </div>
    `;
  },

  fieldSelect(label, value, options, onChange, placeholder = "") {
    const selectedValue = String(value ?? "");
    const optionMarkup = [
      ...(placeholder
        ? [{ value: "", label: placeholder, disabled: false }]
        : []),
      ...(Array.isArray(options) ? options : []),
    ].map(option => {
      const optionValue = String(option?.value ?? "");
      const selected = optionValue === selectedValue ? " selected" : "";
      const disabled = option?.disabled ? " disabled" : "";
      return `<option value="${UI.escapeAttribute(optionValue)}"${selected}${disabled}>${UI.escapeHtml(option?.label ?? optionValue)}</option>`;
    }).join("");
    return `
      <div class="field">
        <label>${UI.escapeHtml(label)}</label>
        <select onchange="${onChange}">${optionMarkup}</select>
      </div>
    `;
  }
};

window.UI = UI;
