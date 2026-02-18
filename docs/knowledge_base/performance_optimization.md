# Base de Conocimiento: Optimización de Rendimiento

Este documento recopila el análisis de cuellos de botella y las estrategias de optimización implementadas o planeadas para SpeedExplorer.

## 🏁 Optimizaciones Implementadas

### 1. Eliminación de Redundancia de I/O en Listado (Zero-Redundancy)
- **Fecha**: 17/02/2026
- **Problema**: `list_files_impl` realizaba dos lecturas de disco por archivo (Enumeración Shell + `path.metadata()`).
- **Solución**: Se inyectó la extracción de metadatos inline usando el path ya obtenido de la enumeración, eliminando el 50% de las llamadas al sistema de archivos.
- **Resultado**: Carga significativamente más rápida en HDDs y carpetas masivas.

---

## 🚀 Próximas Mejoras (Backlog)

### 1. Migración a FindFirstFileW/FindNextFileW
- **Contexto**: Actualmente se usa la Shell API (`IEnumShellItems`) para mayor compatibilidad con carpetas especiales.
- **Oportunidad**: `FindFirstFileW` es mucho más rápido para el sistema de archivos tradicional ya que devuelve todos los metadatos básicos en una sola operación atómica.
- **Estrategia**: Implementar un "Fast-Path" para rutas de disco locales y mantener la Shell API solo como fallback para carpetas virtuales (Recycle Bin, etc.).

### 2. Streaming de Datos (Chunks)
- **Contexto**: La carga actual es monolítica; el frontend espera a que el backend procese los 5000 archivos antes de recibir nada.
- **Oportunidad**: Enviar resultados en lotes (ej: 100 archivos cada 10ms) mediante eventos de Tauri.
- **Estrategia**: Cambiar el comando `list_files` de un único retorno a un modelo basado en eventos o canales.

### 3. Paralelización de Metadatos Extendidos
- **Contexto**: Operaciones como lectura de dimensiones de imagen o metadatos FFmpeg son lentas y bloquean colas.
- **Oportunidad**: Usar `rayon` o tareas masivas de `tokio` para procesar estas colas sin afectar el listado principal.

---

## 📉 Diagnóstico de Cuellos de Botella Comunes

| Operación | Costo Estimado | Mitigación Actual |
| :--- | :--- | :--- |
| **path.metadata()** | 0.1ms - 1ms | Se redujo a una sola llamada por item. |
| **Shell Thumbnail** | 5ms - 50ms | Cache LRU de 500 entradas. |
| **FFmpeg Probe** | 100ms - 500ms | Solo se dispara como fallback asincrónico. |
| **IShellItem Create** | 1ms | Cacheado parcialmente por el SO. |

## 🛠️ Herramientas de Medición recomendadas
- **Cargo Benchmark (Criterion)**: Para medir tiempos de ejecución en el backend de Rust.
- **React DevTools (Profiler)**: Para detectar renders innecesarios al recibir grandes listas.
- **Procmon (Sysinternals)**: Para observar accesos reales a disco y detectar redundancias.
