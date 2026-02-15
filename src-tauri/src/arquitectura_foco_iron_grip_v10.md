# Arquitectura de Foco "Iron Grip" (v10.0) - "The Final Solution"

Esta arquitectura elimina definitivamente la pesadilla de los diálogos que aparecen detrás de la aplicación, resolviendo la raíz técnica del problema: la latencia de activación del sistema operativo.

## Diagnóstico: El "Limbo de Foco"
Los logs de diagnóstico revelaron que, incluso cuando la ventana de SpeedExplorer está en el primer plano (`Foreground`), su estado interno de hilo (`Active`) puede ser `0x0` durante los milisegundos posteriores a un Drop. Esto ocurre porque el OS está cerrando el contexto de Drag & Drop. Si lanzamos el diálogo en ese limbo, Windows no sabe a quién "anclarlo" y lo envía al fondo.

## La Solución: Sincronización por Estado
Hemos abandonado el "juego del gato y el ratón" con los timers para implementar un protocolo de **Sincronización Determinista**:

1. **Drenaje de Mensajes Sincrónico**: En el hilo STA (`sta_worker.rs`), antes de ejecutar la operación, entramos en un bucle de gestión de mensajes nativo de Win32 (`PeekMessage` / `DispatchMessage`).
2. **Espera de Estado Activo**: El bucle no es un "sleep"; es una espera activa que procesa los mensajes del sistema (como `WM_ACTIVATE`) hasta que `GetActiveWindow()` confirma que nuestra ventana es oficialmente la dueña del foco.
3. **Garantía v10.0**: Solo cuando el OS nos confirma que estamos listos, llamamos a `PerformOperations()`. Esto garantiza que el Shell siempre encuentre un dueño válido, eliminando las race conditions por completo.

## Cambios Realizados
- **sta_worker.rs**: Implementación de `drain_and_stabilize_focus` y su aplicación en todos los comandos.
- **lib.rs**: Limpieza total de timers y simplificación del hardening inicial.
- **App.tsx**: Comunicación instantánea (sincrónica) con el backend.
