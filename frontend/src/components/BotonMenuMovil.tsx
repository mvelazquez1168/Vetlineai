// prompt_code_menu_colapsable — botón hamburguesa, solo visible en
// pantallas angostas (md:hidden). 44x44px: tocable con un dedo, no
// pensado para apuntar con cursor.
export function BotonMenuMovil({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir menú"
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-primary hover:bg-black/5 md:hidden"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
