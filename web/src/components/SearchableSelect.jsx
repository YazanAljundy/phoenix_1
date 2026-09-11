import { useEffect, useRef, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 300;

// A Dropdown filter backed by a server-side search rather than a fixed
// option list - for a field whose value set isn't small/bounded enough for a
// plain <select> (e.g. manufacturer names across the whole catalog) but
// still has to resolve to one exact existing value, not free text. Typing
// re-searches (debounced, same 300ms as the page's own text filters);
// picking a result sets the filter and closes the menu. `fetchOptions` is
// called with the trimmed search term and must resolve to a string array.
export function SearchableSelect({
  value,
  onChange,
  fetchOptions,
  placeholder,
  allLabel,
  loadingLabel,
  noMatchesLabel,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState(value || '');
  const [options, setOptions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef(null);

  // The visible text follows the committed value whenever it changes from
  // outside this component (e.g. cleared elsewhere), not just from picking
  // an option here.
  useEffect(() => {
    setInput(value || '');
  }, [value]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setIsSearching(true);
    const timeout = setTimeout(() => {
      fetchOptions(input.trim()).then((rows) => {
        if (cancelled) return;
        setOptions(rows);
        setIsSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [input, isOpen, fetchOptions]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setInput(value || '');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value]);

  const handleSelect = (option) => {
    onChange(option);
    setInput(option);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setInput('');
    setIsOpen(false);
  };

  return (
    <div className="adm-searchable-select" ref={containerRef}>
      <input
        type="text"
        className="adm-filter-search"
        placeholder={placeholder}
        value={input}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          setInput(event.target.value);
          setIsOpen(true);
        }}
      />
      {isOpen && (
        <div className="adm-searchable-select-menu">
          <button
            type="button"
            className="adm-searchable-select-option adm-searchable-select-all"
            onClick={handleClear}
          >
            {allLabel}
          </button>
          {isSearching ? (
            <div className="adm-searchable-select-hint">{loadingLabel}</div>
          ) : options.length === 0 ? (
            <div className="adm-searchable-select-hint">{noMatchesLabel}</div>
          ) : (
            options.map((option) => (
              <button
                key={option}
                type="button"
                className="adm-searchable-select-option"
                onClick={() => handleSelect(option)}
              >
                {option}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
