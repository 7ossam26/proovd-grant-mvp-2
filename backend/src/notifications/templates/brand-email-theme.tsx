/**
 * Locks transactional email to Proovd's light palette.
 *
 * Email clients do not agree on dark-mode behaviour. The two metadata entries
 * cover clients that respect an author's declared scheme; the explicit colour
 * rules cover Apple Mail and Outlook variants that still apply a dark-mode
 * pass. Matching the inline palette keeps buttons, text, and tinted panels in
 * their authored colours instead of flattening the whole message to one tone.
 */
export function BrandEmailTheme() {
  return (
    <>
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light only" />
      <style>{BRAND_LIGHT_CSS}</style>
    </>
  );
}

const BRAND_LIGHT_CSS = `
  :root {
    color-scheme: light only !important;
    supported-color-schemes: light only !important;
  }

  body {
    background-color: #FFFFFF !important;
    color-scheme: light only !important;
  }

  [style*="background-color:#FFFFFF"] {
    background-color: #FFFFFF !important;
    background-image: linear-gradient(#FFFFFF, #FFFFFF) !important;
  }
  [style*="background-color:#41ED98"] {
    background-color: #41ED98 !important;
    background-image: linear-gradient(#41ED98, #41ED98) !important;
  }
  [style*="background-color:#DEFAFC"] {
    background-color: #DEFAFC !important;
    background-image: linear-gradient(#DEFAFC, #DEFAFC) !important;
  }
  [style*="background-color:#E9FFE1"] {
    background-color: #E9FFE1 !important;
    background-image: linear-gradient(#E9FFE1, #E9FFE1) !important;
  }
  [style*="background-color:#F1F1F1"] {
    background-color: #F1F1F1 !important;
    background-image: linear-gradient(#F1F1F1, #F1F1F1) !important;
  }
  [style*="background-color:#F1F9F5"] {
    background-color: #F1F9F5 !important;
    background-image: linear-gradient(#F1F9F5, #F1F9F5) !important;
  }

  [style*="color:#012D10"] { color: #012D10 !important; }
  [style*="color:#013F17"] { color: #013F17 !important; }
  [style*="color:#111111"] { color: #111111 !important; }
  [style*="color:#1A1A17"] { color: #1A1A17 !important; }
  [style*="color:#222222"] { color: #222222 !important; }
  [style*="color:#41ED98"] { color: #41ED98 !important; }
  [style*="color:#669370"] { color: #669370 !important; }
  [style*="color:#A2AFA8"] { color: #A2AFA8 !important; }
  [style*="color:#E9FFE1"] { color: #E9FFE1 !important; }

  @media (prefers-color-scheme: dark) {
    body {
      background-color: #FFFFFF !important;
      background-image: linear-gradient(#FFFFFF, #FFFFFF) !important;
      color: #013F17 !important;
    }
  }

  [data-ogsc] body {
    background-color: #FFFFFF !important;
    background-image: linear-gradient(#FFFFFF, #FFFFFF) !important;
    color: #013F17 !important;
  }
`;
