# Arquitectura de Foco Sincrónica (v9.0) - "Unbeatable Focus"

Este plan elimina definitivamente las condiciones de carrera (race conditions) y la aleatoriedad en el Z-order de los diálogos de Windows, desechando el uso de timers (`sleep`/`setTimeout`) en favor de una sincronización jerárquica nativa.

## Cambios Propuestos

### 1. Backend: Sincronización Estricta de Win32 [lib.rs]
- **Eliminar Timers**: Se eliminarán todos los `std::thread::sleep` de los comandos de archivos.
- **Z-Order Hierarchy (HWND_TOP)**:
    - En `harden_focus`, se usará `SetWindowPos` con `HWND_TOP` (valor `0`). A diferencia de `HWND_TOPMOST`, esto coloca la ventana al inicio de la pila Z de su nivel actual sin forzarla por encima de otras aplicaciones, lo cual es más estable para el gestor de ventanas de Windows.
    - Se mantendrá `AllowSetForegroundWindow(0xFFFFFFFF)` para asegurar la herencia de permisos de foco.

### 2. Backend: Reclamación Prioritaria en STA [sta_worker.rs]
- **Unión y Hardening Sincrónico**: 
    - Inmediatamente después de `AttachThreadInput`, el hilo de trabajo (STA) ejecutará un ciclo de `SetActiveWindow` y `SetForegroundWindow`.
    - Al estar las colas de entrada unidas, esto garantiza que el hilo que está a punto de llamar a `PerformOperations()` sea el dueño absoluto del foco en el sistema operativo en ese preciso microsegundo.

### 3. Frontend: Limpieza de Estado [App.tsx]
- **Eliminar `setTimeout`**: La llamada a `invoke` se realizará inmediatamente tras el evento de drop. No más esperas artificiales.

## Plan de Verificación

### Pruebas de Estrés en Release
1. **D&D Interno Rápido**: Realizar arrastres rápidos a carpetas protegidas.
2. **Operaciones Concurrentes**: Verificar que el foco no se pierda si se intentan abrir múltiples diálogos (confirmaciones de sobreescritura, etc).
3. **Jerarquía Z**: Confirmar que el diálogo siempre sea hijo de la ventana principal y herede su posición en el tope de la pila.
