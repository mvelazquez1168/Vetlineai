// prompt_code_menu_colapsable — fondo oscuro detrás del menú superpuesto.
// Tocarlo cierra el menú sin elegir nada. `claseTop` existe porque
// PlatformAdminLayout tiene una franja superior fija (32px) que el fondo
// no debe tapar — el resto de los paneles no la tienen y usan el default.
export function BackdropMenuMovil({
  onClick,
  claseTop = "top-0",
}: {
  onClick: () => void;
  claseTop?: string;
}) {
  return (
    <div
      onClick={onClick}
      aria-hidden="true"
      className={["fixed inset-x-0 bottom-0 z-30 bg-black/40 md:hidden", claseTop].join(" ")}
    />
  );
}
