# Arquitectura "Synchronous Handshake" (v11.0) - Sincronización Determinista

Este plan resuelve la inconsistencia final del Z-order mediante un protocolo de "Handshake" (apretón de manos) entre el hardware, el hilo de UI y el hilo de trabajo, eliminando cualquier dependencia de timers o suposiciones de velocidad del OS.

## El Problema: El "Eco" del Drag & Drop
Los logs revelaron que el estado `Active` se estabiliza en microsegundos, pero el diálogo de Windows sale segundos después. Esto indica que el motor de OLE del sistema aún tiene "retenido" el contexto de entrada. Lanzar el diálogo en ese instante causa que Windows lo penalice enviándolo al fondo.

## La Solución: Triple Verificación Sincrónica

### 1. Verificación de Hardware (Mouse State)
- El hilo STA esperará en un bucle de micro-latencia hasta que `GetAsyncKeyState(VK_LBUTTON)` reporte que el botón está **ARRIBA**.
- Esto garantiza físicamente que el usuario ha soltado el archivo y que el evento de "Drop" ha terminado su fase de entrada.

### 2. Sincronización de Cola de Mensajes (WM_NULL)
- El hilo STA enviará un `SendMessage(hwnd, WM_NULL)` al hilo principal.
- Como `SendMessage` es bloqueante y los mensajes se procesan secuencialmente, esto obliga al hilo de la UI a terminar de procesar **todos** sus mensajes pendientes (incluyendo los de WebView2 y OLE) antes de que el hilo STA proceda.

### 3. Validación de Foreground de Sistema
- Antes de llamar a `PerformOperations`, se confirmará que `GetForegroundWindow()` coincide con nuestra ventana raíz. No basta con que el hilo se crea activo; el Sistema Operativo debe confirmarlo globalmente.

## Cambios Propuestos

### [sta_worker.rs]
- Implementación de `synchronize_handshake(hwnd)`.
- Reemplazo de `drain_and_stabilize_focus` por este nuevo protocolo más agresivo y determinista.

### [lib.rs]
- Mantener la limpieza de timers actuales.

## Beneficios
- **Cero Timers**: No hay esperas de "a ver si funciona". Se espera por estados de hardware y software confirmados.
- **Determinismo Absoluto**: La operación solo ocurre cuando el OS está físicamente listo para recibir el nuevo diálogo modal.
