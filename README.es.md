# Freezetime

[English](README.md) | **Español** | [Русский](README.ru.md)

Analizador de demos de Counter-Strike 2. Convierte archivos `.dem` en tablas Parquet (mediante [awpy](https://github.com/pnxenopoulos/awpy) 3), calcula estadísticas de equipo y tácticas (ejecuciones T, setups y rotaciones CT), dibuja visualizaciones sobre el radar y ofrece una aplicación web local con repetición 2D de las rondas.

![Repetición 2D de una ronda](docs/replay.gif)

Funciones:

- **Análisis de la demo** — todos los datasets de awpy, todos los eventos del juego, instantáneas de los jugadores cada 0,5 s y fotogramas para la repetición cada 4 ticks.
- **Estadísticas de equipo** — marcador, lados, compras, motivos de victoria, aperturas, trades, plantas y retakes.
- **Tácticas** — a qué sitio va el lado T, cuándo empieza la ejecución, qué granadas lanza y adónde, por dónde entra; cómo se coloca el lado CT y lo rápido que rota.
- **Varias partidas** — totales con porcentajes recalculados, desglose por mapa y jugador, unificación de nombres de equipo (alias).
- **Rival (dosier)** — eliges equipo y mapa: 5–7 conclusiones con número de rondas y enlaces a la repetición, tiempos «zona × segundo», un playbook de estrategias recurrentes, heatmap de varias partidas, economía tras la ronda de pistolas y tras rachas de derrotas, jugadores (armas, trades, posiciones iniciales), exportación a Markdown y PDF.
- **Configuraciones de mapas** — polígonos de los sitios de bomba y callouts de todo el mappool competitivo, niveles para mapas de varios niveles.
- **Aplicación** (`freezetime app`) — biblioteca de demos con filtros por mapa y equipo, subida de `.dem` y archivos comprimidos, borrado y análisis en segundo plano; página de partida; repetición 2D con armas y granadas de los jugadores, mira, recarga, paso silencioso, agacharse y saltar, trazadores de disparos y detalles del duelo al pasar el cursor por el lugar de la muerte; las extracciones antiguas se actualizan desde la demo original; 11 tipos de heatmap (movimiento, muertes, kills, aperturas, disparos, daño, cegados, plantas, granadas) con filtros por tiempo de ronda; todos los lanzamientos de granadas como lineups con exportación y botón «Abrir en CS2»; clips GIF/MP4 de un jugador o equipo en las rondas elegidas de una o varias demos, con subtítulo y descripción en texto; highlights de la partida; agregado de varias partidas. Funciona localmente en el navegador, sin internet.
- **Highlights** — aces, 4K/3K, clutches 1vN ganados, dobles rápidas y kills especiales (no-scope, a través de pared, a través de humo, cuchillo, zeus) se detectan solos a partir del killfeed; los highlights propios se definen por ronda y ventana de tiempo o con el botón «★ Highlight» de la repetición 2D y se guardan en `highlights.json` junto al análisis. Cada uno se descarga como MP4/GIF con zoom en la acción y killfeed; los marcados, en un solo zip.
- **Grabación automática en CS2 (HLAE)** — como los servicios de clips, pero en tu propio PC: la aplicación cierra CS2 si está abierto (tras confirmación), lanza el juego con [HLAE](https://github.com/advancedfx/advancedfx) y `-insecure`, reproduce la demo desde los ojos del jugador y graba cada clip con sonido exactamente por ticks (`mirv_cmd addAtTick`, `mirv_streams`), y luego cierra el juego (`quit`). No se pulsan teclas y el juego puede estar en segundo plano. Se graban los highlights marcados o todas las kills del jugador elegido: las kills cercanas de una misma ronda forman un solo clip; por defecto se elige tu cuenta de Steam. Tras la última kill el clip sigue 3 s (5 s en un clutch, sin pasar del final de la ronda) para que se vea el resultado. Los clips se codifican con un códec por hardware (NVENC/AMF/QSV, si no, x264), se guardan en `<análisis>/recordings` y se ven y descargan en la misma página. Hace falta `ffmpeg` en el PATH (`winget install Gyan.FFmpeg`) o el paquete `imageio-ffmpeg`.
- **HLAE** se instala con un botón de la aplicación desde las versiones oficiales, con verificación SHA-256, en `%LOCALAPPDATA%\freezetime-tools\hlae`. Desde un juego lanzado con HLAE no se puede entrar en servidores VAC. Ya no se ofrece grabar la pantalla o la ventana de un CS2 abierto: HLAE empieza y termina cada toma exactamente en su tick.
- **Recorte de pausas** — al grabar se eliminan las pausas entre kills más largas que un umbral (3 s por defecto): en el modo «todas las kills» esas kills pasan a ser clips separados, y un highlight sigue siendo un solo vídeo con saltos a la siguiente kill (quedan 1,5 s tras una kill y 1,5 s antes de la siguiente), junto con el sonido.
- **Idiomas de la interfaz** — inglés, ruso y español. Por defecto inglés; si el idioma del navegador o de Windows es ruso o español, se activa ese. La elección en el panel lateral se recuerda en el navegador.
- **Pizarra táctica** — dibuja una táctica en cualquier mapa del pool en hasta 4 pasos (default, utilidad, entrada, post-plant): jugadores CT/T y C4 arrastrados desde la barra, 6 granadas con su radio real y punto de lanzamiento, lápiz, flechas, formas y notas de texto. Al arrastrar a un jugador en un paso posterior se graba la ruta que recorre, y la reproducción mueve a los jugadores por sus rutas. Deshacer/rehacer, atajos reasignables, tácticas guardadas con filtro por mapa, exportación a PNG (un paso o todos en cuadrícula), GIF y MP4. El botón «A la pizarra» de la repetición copia el momento actual (jugadores con nombres, humos, fuegos, la bomba), y desde la pizarra se vuelve a ese momento.
- **Paquetes** — `.zip` con pizarras, notas, listas, el playbook y partidas analizadas, para llevar tu trabajo a otro ordenador. Todo se queda en tu ordenador: sin nube ni cuentas.
- **Notas y listas** — una nota con marca de tiempo desde la repetición 2D y listas de rondas o tramos de rondas: carpetas, arrastrar para ordenar, reproducción seguida, corte en GIF/MP4 y grabación en CS2.

| Resumen de partida | Tácticas | Mapas |
|---|---|---|
| ![](docs/overview.png) | ![](docs/tactics.png) | ![](docs/maps.png) |

## Instalación

### Con un solo comando (Windows)

El script [`install.ps1`](install.ps1) instala todo lo necesario: si faltan, Git, Python 3.13 y Node.js LTS (con winget); después clona el proyecto, crea `.venv`, compila el frontend, descarga los radares de awpy y crea un acceso directo `freezetime` en el escritorio. Cómo actualizar una aplicación ya instalada — en la sección [«Actualización»](#actualización).

```powershell
irm https://raw.githubusercontent.com/nfilatoff/freezetime/main/install.ps1 -OutFile install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Por defecto el proyecto se instala en `%LOCALAPPDATA%\freezetime`; para otra carpeta, `-InstallDir 'D:\freezetime'`. Si ejecutas el script desde un repositorio ya clonado, usa ese. Opciones: `-CheckOnly` (solo comprobar), `-SkipRadars`, `-NoShortcut`, `-Dev` (con pytest), `-Launch` (iniciar tras instalar).

### Actualización

**Si venías de cs2lens.** Antes el proyecto se llamaba cs2lens. El script actualiza en el sitio una instalación antigua en `%LOCALAPPDATA%\cs2lens`, quita el paquete, el lanzador y el acceso directo antiguos, y HLAE se mueve solo desde `cs2lens-tools` en el primer uso. Las partidas procesadas se conservan. Los enlaces antiguos a `github.com/nfilatoff/cs2lens` redirigen al nuevo repositorio. En CS2 hay que volver a asignar la tecla una vez: `bind f13 "exec freezetime_cmd"`.

Primero cierra la aplicación: un `freezetime` en ejecución impide reinstalar el paquete. Las partidas analizadas, los clips, la configuración y HLAE no se ven afectados por la actualización.

**Si instalaste con el script.** Vuelve a ejecutar `install.ps1` desde la carpeta donde lo descargaste. Hará `git pull`, actualizará las dependencias y recompilará la aplicación:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Si al instalar indicaste `-InstallDir`, indica aquí la misma carpeta. Si no tienes el archivo a mano, descárgalo de nuevo con el primer comando de la sección anterior.

**Si clonaste el proyecto a mano.** El script ejecutado desde la carpeta del proyecto no actualiza el código por sí mismo, así que primero descarga los cambios y después ejecútalo:

```powershell
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -SkipRadars -NoShortcut
```

`-SkipRadars` y `-NoShortcut` omiten los pasos ya hechos. La actualización sigue la rama actual: para la nueva versión debe ser `main`.

### A mano

Hacen falta Python 3.13 (sirve ≥ 3.11) y Node.js (≥ 20) para compilar el frontend.

```powershell
git clone https://github.com/nfilatoff/freezetime.git
cd freezetime
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"          # freezetime + awpy, polars, matplotlib, typer, fastapi, uvicorn, zstandard; dev — pytest

cd frontend
npm install
npm run build                    # compila el frontend en freezetime/app/static
cd ..
```

awpy descarga los radares y `map_data.json` una vez en `~/.awpy/<versión>/` (comando `awpy get` o primera llamada a `awpy.plot`). La aplicación no descarga nada por sí misma: si el radar no está en la caché, se muestra un fondo vacío.

En la consola de Windows, para cirílico y caracteres especiales en la salida, define `$env:PYTHONIOENCODING = "utf-8"`.

### Primer arranque

```powershell
freezetime app                      # http://127.0.0.1:8000, el navegador se abre solo
```

El acceso directo del escritorio (`start-freezetime.cmd`) recompila la aplicación web antes de iniciarla si sus fuentes cambiaron, por ejemplo tras `git pull` (requiere Node.js; la misma comprobación a mano: `scripts\ensure-frontend.ps1`). Si la compilación actual está en uso (por ejemplo, por una instancia de la aplicación ya en marcha), la recompilación se omite y la aplicación arranca con la compilación que ya tiene.

En «Biblioteca» añade una carpeta con demos (por ejemplo, `D:\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo`) o sube archivos con el botón «Subir .dem o archivo…» o arrastrándolos a la página. Las demos de carpetas se analizan con el botón «Analizar», las subidas, al momento. El análisis va en segundo plano con progreso; una demo de 250–300 MB se analiza en 20–30 s. Las demos ya analizadas no se vuelven a analizar.

### Biblioteca

- **Primero las más recientes** — la biblioteca muestra las 10 últimas partidas analizadas; «Mostrar 10 más» añade las siguientes (los filtros se aplican a todas).
- **Filtros** — por mapa (también para demos sin analizar: el mapa se lee de la cabecera del `.dem` en milisegundos), por equipo y búsqueda por nombre. La casilla «ocultar ya analizadas» quita de la lista las demos que ya están entre las partidas.
- **Subida** — `.dem` o archivo comprimido: `zip`, `rar`, `7z`, `tar` (incluidos `.tar.gz`/`.tgz`/`.tar.bz2`/`.tar.xz`), `.dem.gz`, `.dem.bz2`, `.dem.xz`, `.dem.zst` sueltos. Los archivos se suben de uno en uno con progreso. El cuerpo de la petición se escribe en `.part` y se renombra solo al terminar la subida, así que una subida interrumpida no aparecerá como demo. Un archivo con el mismo nombre y tamaño que uno ya presente en la biblioteca no se vuelve a subir ni a analizar.
- **Archivos comprimidos** se extraen con una tarea en segundo plano: solo se toman los `.dem` (se permiten subcarpetas; las rutas dentro del archivo no pueden salir de `out/_uploads/`), el archivo se borra tras la extracción y cada demo entra en la cola de análisis. `zip`, `tar`, `gz`, `bz2`, `xz` se leen con la biblioteca estándar de Python, `.zst` con el paquete `zstandard`, `rar` y `7z` con el `tar.exe` del sistema (bsdtar/libarchive, incluido en Windows 10+).
- **Borrado** — la cruz de la tarjeta de partida borra la exportación (tablas, caché de repetición, imágenes); con una casilla del diálogo también se puede borrar el `.dem` original. El enlace «borrar» de la lista de demos borra el archivo `.dem`. Por la API solo se borran `.dem` de las carpetas de la biblioteca y de subidas; no se puede borrar una partida o demo que se esté procesando.

**Página de la partida.** La cabecera (equipos, marcador, id) ocupa una línea y las pestañas una fila a la izquierda. Cada pestaña cabe en la ventana sin desplazarse: el radar o el vídeo toma la altura que dejan los controles, las columnas laterales largas (ajustes del clip, lista de highlights, lista de lineups, filtros de mapas) se desplazan por dentro y los paneles de jugadores de la repetición no son más altos que el radar. Las tablas centran las celdas y ajustan el ancho de las columnas a los datos; el texto largo se parte dentro de la celda. En la pestaña Jugadores, un clic en un jugador abre su detalle (`freezetime/player_stats.py`): kills y headshots por arma, tiempo de reacción mediano (estimado), precisión (disparos, disparos que dieron a un rival, impactos en la cabeza; un disparo de escopeta cuenta una vez y cada impacto se asocia al último disparo del jugador, porque `player_hurt` nombra algunas armas de otra forma), daño por arma, flashes lanzadas, rivales cegados con el tiempo medio y total de ceguera y cuántos 2 s o más, y compañeros cegados.

Para exportaciones hechas antes de que existieran los fotogramas de repetición, la tarjeta de partida tiene el botón «datos para la repetición». Añade `replay.parquet` desde la demo original en unos segundos. Sin él la repetición también funciona, pero con paso de 0,5 s.

## Comandos CLI

```powershell
freezetime extract demo.dem [--out out] [--snapshot-seconds 0.5]
```
Analiza la demo en `out/<nombre de la demo>/`.

```powershell
freezetime report  out\Mirage_ArenaPro_vs_LosTopos     # o ruta a un .dem: la analiza si aún no lo está
freezetime tactics out\Mirage_ArenaPro_vs_LosTopos
```
Informes de equipo y tácticos en Markdown: se imprimen en la consola y se guardan como `team_report.md` / `tactics_report.md` en la carpeta de exportación.

```powershell
freezetime batch D:\demos\week1 out\Dust2ArenaPro_vs_teamSirena some.dem --name week1 --alias "team_dr1amwtf=Arena Pro Team"
```
Agregado de varias partidas. Fuentes: `.dem`, carpetas con `.dem` o carpetas de exportación. Resultado: `out/<name>/aggregate_report.md` y tablas `*.parquet`. `--alias ANTIGUO=NUEVO` se puede repetir.

```powershell
freezetime viz kills   out\<partida> [--side t|ct] [--attacker]   # heatmap de lugares de muerte (o posiciones de los asesinos)
freezetime viz utility out\<partida> [--side t|ct] [--team NAME]  # dónde cayeron las granadas
freezetime viz frame   out\<partida> 7 --sec 40                   # fotograma de la ronda 7, 40 s después del freezetime
freezetime viz gif     out\<partida> 7 [--step-sec 0.5] [--fps 4] # repetición GIF de la ronda (matplotlib)
freezetime viz zones   de_nuke                                    # configuración del mapa sobre el radar + plantas de out/
```
Los PNG/GIF se guardan en `out/<partida>/viz/` (`viz zones`, en `out/maps/`). En mapas de varios niveles (Nuke) se dibujan dos paneles: nivel superior e inferior.

```powershell
freezetime maps list                                           # mapas con configuración, niveles, número de zonas
freezetime maps derive a.dem b.dem [--output path.json]        # crear/actualizar la configuración de un mapa a partir de demos
```

```powershell
freezetime app [--out out] [--host 127.0.0.1] [--port 8000] [--no-open-browser]
```
Inicia la aplicación web.

Desarrollo del frontend: `freezetime app --port 8000` en una ventana y `cd frontend; npm run dev` en otra. Vite redirige `/api` al puerto 8000.

Tests: `pytest`. El fixture son las rondas 1–8 de una partida de Dust2, generadas con `tests/make_fixture.py`.

## Dónde están los datos

| Ruta | Contenido |
|---|---|
| `out/<demo>/` | Exportación de una demo (ver abajo). |
| `out/<demo>/replay/round_<n>.v<k>.json.gz` | Caché de datos de repetición por ronda; se crea al abrir la ronda por primera vez (repetición o clip). Si cambia el formato (`k`), los archivos antiguos se ignoran, y un archivo de caché anterior a la malla de visibilidad del mapa en `~/.awpy` se reconstruye en cuanto esa malla queda en caché. |
| `out/<demo>/viz/` | Imágenes de `freezetime viz`. |
| `out/<name>/` | Resultado de `freezetime batch`. |
| `out/maps/` | Dibujos de `freezetime viz zones`. |
| `out/library.json` | Configuración de la aplicación: carpetas de demos, carpeta de CS2 y puerto de la consola de red, nombres de equipos (`team_aliases`), equipo propio (`own_team`). |
| `out/boards/<id>.json` | Pizarras tácticas guardadas. |
| `out/team.json` | Queda de versiones anteriores (el antiguo perfil del equipo). No se usa; si existe, sus nicks nombran las tareas de un playbook antiguo al leerlo. |
| `out/notes.json` | Notas con marca de tiempo: partida, ronda, segundo, texto. |
| `out/playlists.json` | Listas: nombre, carpeta, dueño y tramos (partida, ronda, segundos desde–hasta, pie). |
| `out/playbook.json` | Playbook: entradas, libros ordenados, tareas por hueco de jugador, utilidad copiada y referencias a adjuntos. |
| `<CS2>/game/csgo/cfg/freezetime_*.cfg` | Lineups y listas de práctica escritos con los botones «Abrir en CS2» e «Instalar en CS2». |
| `out/_uploads/` | Demos subidas desde la aplicación (y extraídas de archivos comprimidos). |
| `~/.awpy/<versión>/` | Caché de awpy: radares (`radars/*.png`) y `map_data.json` (transformación de coordenadas, niveles). |
| `freezetime/maps/<map>.json` | Configuraciones de mapas (en el repositorio). |

Las demos, las exportaciones y `node_modules` no van a git (ver `.gitignore`).

### Formato de exportación

`out/<demo>/`:

- `manifest.json` — cabecera de la demo (`header.map_name`, …), `tick_rate`, `demo_path`, `replay_every` y número de filas de cada tabla.
- Datasets de awpy: `rounds`, `kills`, `damages`, `shots`, `grenades` (posición de la granada en cada tick de vuelo), `smokes`, `fires`, `blinds`, `bomb`, `item_events`, `players`, `stats`, `round_economy`, `chat`.
- `snapshots.parquet` — estado de todos los jugadores cada 0,5 s: posición, mirada, HP, armadura, arma, dinero, flags.
- `replay.parquet` — lo mismo para la repetición: cada 4 ticks, solo las columnas necesarias.
- `events/<evento>.parquet` — todos los eventos del juego tal cual (`weapon_fire`, `smokegrenade_detonate`, …). **Todos los campos son cadenas.**

## Mapas compatibles

Mappool Active Duty de CS2 a **30.10.2026**: Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke. Cache sustituyó a Overpass en julio de 2026, Anubis sustituyó a Train en enero de 2026. Fuentes: [Wikipedia](https://en.wikipedia.org/wiki/List_of_competitive_Counter-Strike_maps), [neuralboost.gg](https://neuralboost.gg/blog/cs2-maps-every-pool-the-rotation-history-and-what-each-map-demands). Los siete mapas tienen radar y `map_data` en la versión de awpy-data usada (2000935); Nuke tiene además un radar inferior.

| Mapa | Configuración | Cómo se creó | Verificación |
|---|---|---|---|
| de_ancient | ✓ | `maps derive`, 1 demo | demos reales: 14/14 plantas dentro del polígono de su sitio |
| de_anubis | ✓ | `maps derive`, 2 demos | demos reales: 31/31, incl. 19/19 en una demo no usada para crearla |
| de_dust2 | ✓ | `maps derive`, 3 demos | demos reales: 28/28 |
| de_inferno | ✓ | `maps derive`, 1 demo | demos reales: 6/6 |
| de_mirage | ✓ | `maps derive`, 2 demos | demos reales: 22/22 |
| de_cache | ✓ | `maps derive`, 1 demo; grupos de zonas a mano; sitios: contorno en el radar + demo | demo real: 10/10 plantas dentro del polígono de su sitio, pero es la misma demo usada para crearla |
| de_nuke | ✓ (2 niveles) | `maps derive`, 1 demo; grupos de zonas a mano; sitios: contorno en el radar + demo | demo real: 6/6 plantas dentro del polígono de su sitio, pero es la misma demo usada para crearla |

Los grupos de zonas de Cache y Nuke se definieron a mano según la geometría del mapa y según quién llega a cada zona y cuándo, así que conviene revisar algunas zonas dudosas (en Nuke, Control y Admin). Cuando haya más demos, la configuración se puede regenerar: `freezetime maps derive <todas las demos del mapa>`. Los grupos se conservan por nombre de zona, y las zonas nuevas habrá que completarlas a mano. Los polígonos de los sitios se reconstruyen solo a partir de las demos, así que revísalos con `freezetime viz zones`: una sola demo cubre el sitio solo en parte.

Los mapas fuera del pool (Overpass, Train, Vertigo, …) no tienen configuración. `tactics` usa para ellos una heurística de reserva y muestra un aviso. Las visualizaciones funcionan en todos los mapas con radar.

| Mirage (creado a partir de demos) | Nuke (a partir de una demo, dos niveles) |
|---|---|
| ![](docs/zones_mirage.png) | ![](docs/zones_nuke.png) |

## Estructura del proyecto

```
.dem ──extract──▶ out/<demo>/*.parquet ──context──▶ Match ──▶ team_stats ─┐
                                                        ├──▶ tactics ◀── maps (configuraciones de mapas)
                                                        ├──▶ replay  ├──▶ report (Markdown), viz (PNG/GIF)
                                                        └──▶ aggregate ┘──▶ app (FastAPI + React)
```

| Módulo | Qué hace |
|---|---|
| `extract.py` | `.dem` → Parquet: datasets de awpy, eventos, instantáneas, `replay.parquet`, `manifest.json`. `add_replay()` añade fotogramas de repetición a exportaciones antiguas. |
| `context.py` | `load_match()` crea el contexto común. Rondas sin las de cuchillo. steamid → equipo (sin entrenadores). Lado del equipo en cada ronda. Tabla `tr` (ronda × equipo: lado, victoria, compra, compra del rival). Paso y desfase de las instantáneas. `with_round()` asocia las filas con `tick` a una ronda. `round_context()`: qué pasó antes de la ronda (pistolas, racha de derrotas, vivos en la planta y al final). `with_man_diff()`: superioridad o inferioridad numérica en el momento del evento. |
| `team_stats.py` | Resumen, lados, compras, motivos de victoria, aperturas, trades, bomba como T y como CT. |
| `player_stats.py` | Un jugador de una partida: kills por arma, precisión (disparos e impactos), flashes y tiempo de ceguera, tiempo de reacción mediano. |
| `tactics.py` | Ejecuciones T, setups CT, rotaciones. `SiteZoner` clasifica las posiciones según la configuración del mapa o la heurística de reserva. |
| `maps/` | Configuraciones de mapas (`<map>.json`) y su carga; búsqueda de zona, grupo y sitio de un punto mediante un ráster. |
| `mapgen.py` | Crea la configuración de un mapa a partir de demos (`maps derive`). |
| `aggregate.py` | Agregación entre partidas, alias de equipos, jugadores de un equipo en las demos. |
| `scout.py` | Dosier del rival: tablas por ronda de la partida (`match_data`), selección de rondas del equipo (`select_rounds`), informe y conclusiones (`dossier`), rondas similares, equipos con plantilla compartida. |
| `replay.py` | Documento de repetición de la ronda (JSON, caché gzip). |
| `board.py` | Pizarras tácticas: comprobar, guardar y listar `out/boards/<id>.json`. |
| `pack.py` | Paquetes: exportación e importación de un `.zip` con pizarras, notas, listas, el playbook y partidas analizadas. |
| `notes.py` | Notas con marca de tiempo: almacenamiento, edición, combinación desde paquetes. |
| `playlists.py` | Listas: almacenamiento, tramos, combinación desde paquetes. |
| `playbook.py` | Playbook: validación, almacenamiento atómico, entradas, libros, tareas por hueco, lectura del formato antiguo, utilidad de demos y combinación de paquetes. |
| `viz.py` | Imágenes sobre el radar (matplotlib mediante `awpy.plot`), paneles por nivel. |
| `report.py` | Informes en Markdown. |
| `cli.py` | Comandos `freezetime`. |
| `app/server.py`, `app/jobs.py` | FastAPI: biblioteca (subida, borrado), cola en segundo plano (extracción, análisis, fotogramas de repetición), API de partida, repetición, mapas y agregado, servido del frontend. No duplica el análisis: llama a los módulos anteriores. |
| `app/archives.py` | Extracción de `.dem` de los archivos comprimidos subidos. |
| `lineups.py` | Lanzamientos de granadas como lineups: posición, mira, técnica, aterrizaje; comandos de consola y configuraciones de práctica. |
| `app/cs2.py` | Conexión con CS2: búsqueda de la carpeta del juego, escritura de `.cfg`, consola de red (`-netconport`), arranque mediante Steam. |
| `frontend/` | React + TypeScript + Vite. La repetición y los clips se dibujan en Canvas 2D. |
| `frontend/src/replayDraw.ts` | Común a repetición y clips: caché de rondas, interpolación, estado del jugador con inventario, icono del jugador, trazadores, cruces de muerte, granadas. |
| `frontend/src/board.ts`, `pages/Board.tsx` | Pizarra táctica: modelo (pasos, fichas con rutas, marcas), dibujo, reproducción, fotograma de repetición → pizarra; la página del editor. |
| `frontend/src/components/ClipView.tsx`, `clipExport.ts` | Constructor de clips, maquetación del fotograma, codificación a GIF (gifenc) y MP4 (WebCodecs + mp4-muxer), zip (fflate). |
| `frontend/src/clipSummary.ts`, `zones.ts` | Datos del clip: zona de un punto (según la configuración del mapa), subtítulo y archivo de texto. |
| `frontend/src/heat.ts`, `components/MapsView.tsx` | Heatmap: acumulación en una cuadrícula de 256×256, desenfoque, paletas, modos y filtros. |
| `frontend/src/components/LineupsView.tsx` | Lineups: agrupación de lanzamientos, mapa, tabla, exportación, botones de CS2. |
| `frontend/src/pages/Scout.tsx`, `components/InsightCards.tsx`, `scoutExport.ts` | Página «Rival»: panel de contexto, pestañas del informe, tarjetas de conclusiones, exportación. |

### Aplicación: cómo funciona la repetición

El backend reúne la ronda en un único documento JSON:

- una cuadrícula común de ticks (paso de 4 ticks);
- arrays por jugador: `x`, `y`, `z`, `yaw`, `hp`, `armor`, arma activa, bomba, kit, desactivación;
- inventario: los momentos en que cambia y su contenido (arma principal, pistola, cada granada por separado: dos flashes dan dos entradas); se toma de las instantáneas de 0,5 s;
- trayectorias de granadas con quien las lanzó (el jugador más cercano al primer punto);
- humos y molotovs con su duración real;
- cegados, eventos de la bomba;
- disparos de armas de fuego: tirador, posición, dirección de la mirada y, si el disparo acertó, posición del herido (el daño en `damages` cae en el mismo tick que el disparo);
- kills con detalles del duelo: daño y número de impactos en ambos sentidos durante la ronda, HP del asesino tras la kill, arma de la víctima, impacto final, distancia, tiempo desde el primer impacto, asistencia, trades.

El documento se guarda en caché comprimido (60–90 KiB por ronda). La partida cargada se mantiene en la memoria del servidor, así que montar una ronda en frío lleva unos 0,1 s (20 rondas, menos de 2 s) y una carga repetida, unos 10 ms; la siguiente ronda se precarga. El cliente interpola posiciones y ángulos de visión entre fotogramas.

Qué hay en el mapa:

- **Jugador** — un círculo del color del lado, barra de HP, nombre. Cono de visión: degradado, bordes brillantes y línea blanca de mira. Con la casilla «armas» (desactivada por defecto para no recargar el icono), debajo del icono aparecen el arma activa (como silueta) y puntos de colores del equipamiento: humo (gris), flash (blanco), HE (rojo), molotov/incendiaria (naranja), señuelo, bomba (cuadrado rojo), kit (cuadrado verde); la granada en la mano va rodeada de blanco. Borde rojo: el jugador lleva la bomba; destello amarillo: está disparando.
- **Disparo** — trazador desde el tirador: si la bala acertó, la línea llega hasta el herido y termina en un punto rojo; si no, un rayo de ~900 unidades en la dirección de la mirada con una flecha que se desvanece al final. Casilla «disparos».
- **Lugar de la muerte** — una cruz del color del lado de la víctima. Al pasar el cursor se muestra la tarjeta del duelo (quién, a quién, con qué, headshot/a través de pared/a través de humo/cegado, daño e impactos en ambos sentidos, HP del asesino, arma de la víctima, distancia, duración, asistencia, trades) y, en el mapa, la posición del asesino y la línea del disparo. Un clic rebobina al inicio del duelo.
- Paneles laterales — HP, armadura, dinero, armas como siluetas (la activa resaltada) y granadas de cada jugador; la tarjeta de un jugador muerto se atenúa y se marca con ✕. El killfeed en la esquina del mapa usa iconos como el juego: arma, headshot, a través de la pared, a través del humo, sin mira, atacante cegado y asistencia con flash (cada icono tiene su indicación al pasar el cursor). Un clic en la tarjeta de un jugador vivo copia `setpos x y z; setang 0 yaw 0` del momento actual: pégalo en la consola de CS2 en tu propio servidor para colocarte donde estaba. La inclinación de la vista no está en los fotogramas de la repetición, así que es 0. La cabecera de cada equipo muestra el marcador al inicio de la ronda, los jugadores vivos (N/total), el dinero del equipo ahora y el tipo de compra con el valor del equipamiento al inicio de la ronda; «4 v 3» junto al reloj cuenta los jugadores vivos de ambos lados. La tarjeta de un jugador muestra el daño a enemigos y las bajas de esta ronda hasta el momento actual. Un jugador golpeado se pone rojo medio segundo en el mapa, con un número de daño flotante (casilla «daño»; el golpe mortal se muestra donde cayó el jugador). Los clips exportados conservan el destello rojo sin los números. **Quién ve a quién** es una estimación por línea de visión sobre la malla del mapa, campo de visión de ±53° y humos: un anillo en los jugadores que ve un enemigo (casilla «avistados», un ojo en la tarjeta); al pasar el cursor sobre un jugador se dibujan líneas discontinuas hacia los enemigos que lo ven y los que él ve. La tarjeta del duelo muestra el tiempo de reacción del atacante y la víctima. Es una aproximación por geometría del mapa (no los datos de avistamiento del juego) y necesita la malla del mapa que awpy guardó en `~/.awpy`; no se descarga nada.
- **Punto de lanzamiento** — un anillo del color de la granada donde estaba quien la lanzó; se ve mientras la granada vuela y 6 s después del lanzamiento. Al pasar el cursor se muestra quién la lanzó, y un clic copia `setpos` / `setang` con los ángulos reales del lanzamiento (el `weapon_fire` de la granada). **Humos y fuegos** muestran una cuenta atrás: un anillo que se vacía en sentido horario alrededor de los segundos restantes, sobre un disco del color del lado de quien la lanzó (el lado sale de la granada cuyo vuelo termina donde aparece la nube o el fuego). Un **flash** deja durante 3 s un anillo discontinuo con un punto del color de quien lo lanzó donde explotó (casilla «flashes»). Cada granada tiene su propia silueta (humo, flash, HE, molotov, incendiaria, señuelo): la granada en vuelo se dibuja como su silueta, las tarjetas de jugador y los iconos bajo los jugadores en el mapa muestran las granadas que llevan como siluetas blancas, y la línea de tiempo bajo el mapa marca cada granada en su lanzamiento con la silueta del color del lado de quien la lanzó; al pasar el cursor se ve quién la lanzó. Las armas, granadas, armadura, casco, kit y C4 usan SVG de Valve CS2 incluidos localmente (`frontend/src/assets/equipment/`); los renderizadores compartidos React/Canvas mantienen las mismas siluetas en tarjetas, radar, línea de tiempo y bajas de los clips. La fuente y atribución constan junto a los SVG.
- **Dibujo** — «✎ Dibujar» (o D) convierte el mapa en una pizarra: lápiz, flecha (Shift ajusta a 45°) y goma, cinco colores (X / Shift+X los recorren), tres grosores para el lápiz y la flecha (clic derecho en el botón de la herramienta para el siguiente), deshacer y limpiar. El botón derecho del ratón borra. Mientras se dibuja, la vista está fijada: la rueda y arrastrar no acercan ni mueven el radar. Los dibujos se mantienen en su sitio entre rondas de la partida, no se guardan en disco y pasan a la pizarra con «⧉ A la pizarra». Mientras se dibuja, los clics en los lugares de muerte y en los puntos de lanzamiento están desactivados.

Controles de la repetición (la rueda del ratón acerca el radar alrededor del cursor y arrastrar lo mueve — nombres, humos y dibujos se acercan con él, los iconos de jugadores mantienen su tamaño; 🔒 fija la vista, ⟲ muestra todo el radar; sobre el mapa, en lugar de la lista de rondas, una fila de botones subrayados con el color del lado ganador y un hueco en cada cambio de lado):

| Tecla | Acción |
|---|---|
| Espacio · mantener Q · mantener E | reproducir/pausa · hacia atrás mientras se mantiene · al doble mientras se mantiene |
| ← / → | ±5 s |
| Shift + ← / → | fotograma atrás/adelante |
| ↑ / ↓ | velocidad (0,25×–8×) |
| N / P | kill siguiente/anterior |
| [ / ] | ronda anterior/siguiente (en una playlist: elemento anterior/siguiente) |
| Home · 0 | fin del freezetime · todo el radar (restablecer zoom) |
| 1 / 2 / 3 | nivel superior / inferior / ambos (en Nuke); el botón central del ratón los recorre, un doble clic en el mapa muestra solo ese nivel o cambia al otro |
| D | activar/desactivar el dibujo |
| 1 / 2 / 3 al dibujar | lápiz / flecha / goma |
| X / Shift + X al dibujar | color siguiente / anterior |
| Ctrl + Z, C, Esc al dibujar | deshacer, limpiar, dejar de dibujar |

El enlace `#/match/<partida>/replay/<ronda>/<segundo>` abre la ronda en el momento indicado.

### Aplicación: clips GIF/vídeo

La página «Clips» (y la pestaña de partida «Clip del jugador», donde esa partida ya está elegida) monta un vídeo de un jugador o de todo un equipo en las rondas elegidas, a partir de una o varias demos del mismo mapa.

- **Demos** — el mapa y casillas de las partidas de ese mapa; las partidas se numeran `M1`, `M2`… en el orden de selección.
- **A quién mostrar** — un jugador (se reconoce por steamid en todas las demos; entre paréntesis, en cuántas de las elegidas jugó) o el equipo entero (cada jugador con su color).
- **Rondas** — los filtros por lado (T por defecto), resultado y compra (full buy, force, eco, pistolas) eligen rondas en todas las partidas a la vez; las fichas por partida añaden o quitan rondas sueltas (borde: lado; número en negrita: victoria).
- **Cómo mostrar**: *superposición* — todas las rondas a la vez sobre un temporizador común de ronda; *por turnos* — las rondas una tras otra.
- **Ventana** — desde qué segundo y hasta cuál tras el freezetime (vacío: hasta el final de la ronda más larga).
- **Capas** — trayectorias, «adónde mira», disparos (trazadores), granadas y C4, kills y muertes, resto de jugadores (puntos tenues), cuadrícula.

El fotograma se compone así:

- **Cabecera** — `jugador · lado · zona principal` (por ejemplo `dr1amwtf · T · Top of Mid`), debajo el equipo, el mapa, el filtro de compra y los rivales («FUT Esports · Dust2 · full buy contra Team Vitality»), el número de rondas superpuestas; a la derecha el reloj de ronda y «vivos N/M · velocidad 2×».
- **Radar** con cuadrícula A–P × 1–16 (para conversaciones del tipo «estaba en H15»). El jugador es un punto del color del lado con una línea hacia donde mira, sin armas ni equipamiento. Un punto rojo es su kill (en el lugar de la víctima), una cruz blanca, su muerte; lugares de granadas: humo — círculo gris, molotov — naranja, flash — anillo blanco, HE — anillo amarillo, plantado de C4 — cuadrado rosa.
- **Subtítulo** — lo genera el código, sin red neuronal, a partir de la configuración de zonas del mapa (`freezetime/maps/<map>.json`): la posición más estable del jugador (la zona fuera del spawn donde más a menudo está en el mismo momento de la ronda) y las granadas habituales (tipo y zona de aterrizaje, tiempo mediano, en al menos el 20% de las rondas, como máximo tres). Ejemplo: «Outside Tunnel a 1:50 en 5 de 10. Flash Lower Tunnel ~1:45 (2 de 10), molotov Short Stairs ~1:23 (2 de 10)». Los mapas sin configuración de zonas no tienen subtítulo. En modo equipo, solo granadas.
- **Leyenda** de los símbolos.

**Exportación** — siempre un archivo zip con dos archivos:

- `<jugador>_<mapa>_<lado>_<N>r_<modo>.mp4` o `.gif`. Los fotogramas se dibujan de uno en uno a la frecuencia elegida (1 s de vídeo = velocidad × 1 s de juego), así que el resultado no depende de la velocidad del ordenador. **MP4** — WebCodecs (H.264; si no, VP9 o AV1) y `mp4-muxer`, primero se prueba el codificador por software; requiere Chrome/Edge 94+ o Firefox 130+. **GIF** — `gifenc`, una paleta común para todo el vídeo; GIF no comprime entre fotogramas, así que por defecto son 512 px y 10 fps.
- `<mismo nombre>.txt` (UTF-8) — todo lo necesario para escribir el subtítulo con tus palabras y mandarlo al chat del equipo: jugador, equipo, mapa, lado, compra, rivales y partidas; ventana y resultados; el subtítulo generado por el código; posición cada 5 s (zonas principales y en cuántas rondas sigue vivo); todas las granadas por tipo y zona con tiempo mediano y número de rondas; kills y muertes (tiempo, desde → hacia, arma, headshot, trade); plantados de C4; una línea por ronda. El mismo texto aparece bajo el botón de exportar («Descripción para el chat»).

### Aplicación: mapas (heatmap)

Pestaña de partida «Mapas». Modos:

| Modo | Qué hay en el mapa | Peso del punto |
|---|---|---|
| movimiento | posiciones de los jugadores vivos, 16 veces por segundo (`replay.parquet`; sin él, instantáneas de 0,5 s); la densidad la calcula el servidor en una cuadrícula de 256×256 | tiempo |
| dónde murieron / desde dónde mataron | posiciones de víctimas / asesinos | 1 |
| primeras kills / primeras muertes | lo mismo para la primera kill entre equipos de la ronda | 1 |
| desde dónde dispararon | posición del tirador en cada bala (sin cuchillo ni granadas) | 1 |
| dónde recibieron daño / desde dónde hicieron daño | posiciones de heridos / atacantes | daño |
| dónde los cegaron / desde dónde lanzaron flashes | cegados por el rival / quienes lanzaron la flash | duración del cegado |
| plantas | lugares de plantado de la bomba | 1 |
| granadas | dónde estalló la granada (puntos por tipo) | — |
| zoom de AWP | dónde el francotirador abrió la mira (evento `weapon_zoom`, AWP y SSG 08; los clics con menos de 2 s de diferencia cuentan como uno) | 1 |

Filtros: equipo, lado, jugador, arma (para kills, disparos y daño; por ejemplo, solo AWP), rango de rondas y tiempo de ronda («toda la ronda» — desde el fin del freezetime, «con freezetime», 0–20 s, 20–45 s, 45–75 s, 75+ s o límites propios). Contexto: compra del equipo, compra del rival, ronda tras pistolas perdidas o ganadas, superioridad, igualdad o inferioridad de vivos en el momento del evento. Visualización: radio de desenfoque, paleta (fuego, verde, hielo, roja), escala logarítmica (se ven también los lugares raros) o lineal (solo los más frecuentes), opacidad, puntos encima, zonas del mapa. Un clic en un punto abre su ronda en la repetición.

### Aplicación: nombres de posiciones

El selector «posiciones» superpone en el radar los nombres de las zonas de la configuración del mapa: en la repetición, el Heatmap, los lineups y las posiciones iniciales de los jugadores. Tres modos: desactivado, nombres, nombres y límites de zonas. El modo es común y se recuerda en el navegador. En el constructor de clips es una capa aparte, porque acaba en el vídeo final; su aspecto sigue el modo común y, con el común desactivado, la capa dibuja nombres y límites. Los vídeos de highlights no llevan nombres. La página «Posiciones» muestra todos los mapas del pool sin demos y tiene su propio selector; al pasar el cursor por un nombre de la lista, la zona se resalta en cualquier modo. Los nombres son los mismos que el juego muestra junto al jugador en el radar (`m_szLastPlaceName`).

**Editor de zonas.** El botón «Editar zonas» de la página «Posiciones» cambia el propio config del mapa (`freezetime/maps/<mapa>.json`): arrastra una esquina, arrastra el punto en medio de un lado para añadir una esquina, Alt+clic en una esquina la quita, arrastra la zona elegida para moverla; dibuja una zona nueva esquina a esquina (Enter o un clic en la primera esquina la cierra); ponle nombre, grupo y nivel. «Suavizar bordes» endereza los escalones de las zonas construidas con demos (celdas de 32 unidades) con la tolerancia elegida; la rueda hace zoom, Ctrl+Z deshace. Guardar no toca los sitios de bomba ni el `place` de nav de cada zona y vacía la táctica en caché, así que los análisis nuevos usan los nuevos límites. El archivo está en la carpeta de la aplicación: haz commit para conservarlo; un `freezetime maps derive` posterior vuelve a construir los polígonos con demos y solo conserva los grupos.

### Aplicación: pizarra táctica

La página «Pizarra» (`#/board`, `freezetime/board.py`, `frontend/src/board.ts`, `pages/Board.tsx`) es una pizarra sobre el radar del mapa para dibujar una táctica y enseñarla al equipo.

- **Pasos** — hasta 4: default, utilidad, entrada, post-plant (doble clic para renombrar). Granadas, dibujos y textos pertenecen a un paso; la casilla «paso anterior» muestra el paso previo atenuado.
- **Jugadores y la bomba** — arrastra CT, T o C4 desde la barra al mapa (un clic lo suelta en el centro). Un jugador conserva su posición en los pasos siguientes hasta que lo muevas. Al arrastrar a un jugador en los pasos 2–4 se graba el camino que recorre: esa es su ruta, dibujada como línea punteada con flecha. «Borrar ruta» la vuelve recta, «Quedarse quieto» deja al jugador donde estaba. Doble clic renombra a un jugador.
- **Granadas** — humo, molotov, incendiaria, flash, HE y señuelo se dibujan con el radio que usa la repetición (humo 144 unidades, fuego 110). Una granada seleccionada tiene un punto naranja: arrástralo hasta donde se lanza y el lanzamiento se dibuja como un arco.
- **Dibujo** — lápiz (5 colores, 3 grosores), flecha (Shift ajusta a 45°), rectángulo y elipse (Shift da un cuadrado o un círculo), nota de texto, borrador. El clic derecho borra lo que hay bajo el cursor.
- **Mapas con niveles** — en Nuke se ven ambos niveles lado a lado (o uno de ellos); un jugador se puede arrastrar de un nivel a otro.
- **Reproducción** — «Reproducir» (Espacio) se detiene en cada paso y lleva a los jugadores por sus rutas al siguiente; la utilidad del paso aparece poco a poco.
- **Atajos** — V seleccionar, P lápiz, A flecha, R rectángulo, C elipse, T texto, E borrador, Espacio reproducir, O paso anterior, Q/W paso atrás/adelante, 1–4 pasos, Ctrl+Z / Ctrl+Shift+Z deshacer/rehacer, Supr borrar. Las teclas de herramientas se reasignan en «Atajos» y se recuerdan en el navegador.
- **Guardar** — «Guardar» escribe `out/boards/<id>.json` (con la versión del formato), «Actualizar» sobrescribe la táctica cargada, «Guardar como nueva» hace una copia. La lista de la derecha muestra las tácticas del mapa (o de todos). Una pizarra sin guardar sobrevive a recargar la página.
- **Exportación** — PNG del paso actual o de todos los pasos en cuadrícula con título, GIF o MP4 de la reproducción (práctico para Discord).
- **Desde la repetición** — «⧉ A la pizarra» copia el momento actual al paso 1: jugadores vivos con nombres y bandos, humos, fuegos, la bomba y lo que hayas dibujado sobre la repetición. «Pizarra» abre una pizarra vacía del mismo mapa. Ambos recuerdan el momento, y «◀ Volver a la repetición» regresa a la misma ronda y segundo.

### Aplicación: paquetes y enlaces

- **Paquetes** — «Descargar un paquete», al final de la Biblioteca, crea un `.zip` con todas las pizarras, notas, listas, el playbook y, si se eligen, partidas analizadas (solo tablas Parquet: sin `.dem`, sin caché de repetición ni grabaciones). «Importar un paquete…» lo combina con tus datos: una pizarra, nota, lista o entrada del playbook sustituye a la local con el mismo id solo si es más nueva; una partida que ya está en la biblioteca se queda como está. Los nombres de archivo del paquete se comprueban antes de escribir nada. Un paquete de una versión anterior puede traer un perfil del equipo: no se importa.
- **Enlaces** — «🔗 Enlace» en la repetición copia un enlace a la ronda y al segundo; en una pizarra guardada, a la táctica.

La aplicación solo responde a su propio ordenador, incluso iniciada con `--host 0.0.0.0`. Las versiones anteriores tenían un servidor del equipo (`--team`) con plantilla, roles y acceso por enlace; se quitó para que la aplicación siga siendo la herramienta de un analista. Su último estado se guarda en la rama `archive/team-server`.

### Aplicación: notas y listas

- **Notas** — «📝 Nota» en la repetición 2D escribe una nota en el segundo actual de la ronda (`freezetime/notes.py`, `out/notes.json`). Las notas de una ronda se listan bajo la repetición y se marcan en su línea de tiempo; un clic salta al momento. La página «Notas» (`#/notes`) muestra las notas de todas las partidas, primero las más nuevas o por partida y ronda, y permite editarlas y borrarlas. La exportación en Markdown del dosier del rival termina con las notas de sus partidas.
- **Listas** — «☆ A la lista» en la repetición 2D añade la ronda, o un tramo (segundos desde–hasta tras el fin del freezetime; vacío significa desde el fin del freezetime / hasta el final de la ronda), con un pie a una lista nueva o existente (`freezetime/playlists.py`, `out/playlists.json`). La página «Listas» (`#/playlists`) las agrupa por carpeta y muestra las recientes; dentro de una lista, los tramos se reordenan arrastrando y se editan en el sitio. «▶ Reproducir» (`#/playlist/<id>/<tramo>`) reproduce los tramos uno tras otro en la repetición 2D, con paso al siguiente y cambio a otra lista. «Añadir sus highlights» convierte los highlights automáticos y propios de una partida en tramos (los highlights se quedan donde están). Vídeo: cada tramo se dibuja sobre el radar como un clip de highlight, en GIF o MP4, todo en un zip; un tramo hasta el final de la ronda se corta a los 90 s. «Grabar en CS2» (en el ordenador de la aplicación) envía los tramos de una partida al grabador.
- Las notas y las listas entran en los paquetes junto con las pizarras y el playbook.

### Aplicación: playbook

La página «Playbook» (`#/playbook`, una entrada en `#/playbook/<id>`) guarda estrategias, protocolos cortos y posiciones en `out/playbook.json`. Cada entrada tiene mapa, lado, categoría, descripción, pasos ordenados y tareas de los jugadores. Una tarea pertenece a un hueco: un nick, un rol o una posición («Entry», «Ancla B»); se sugieren los nicks de los jugadores de tu equipo en las demos (★ en la página Rival). Un playbook del formato antiguo, con tareas ligadas a una plantilla, se lee tal cual: cada tarea recibe el nick del jugador de `out/team.json` si existe.

- Crea playbooks con nombre para un mapa, rival o torneo. Una entrada puede estar en varios: cambia su pertenencia en el editor. Arrastra entradas para reordenarlas dentro de un libro o usa la flecha hacia arriba. Las fijadas aparecen primero; la categoría y la fijación se aplican en todos los libros. Eliminar un libro conserva sus entradas; eliminar una entrada la quita de todos los libros.
- Adjunta una pizarra, una ronda o segmento, una lista, un MP4 del grabador o un enlace HTTPS de YouTube/Twitch. Las rondas y listas se reproducen dentro de la tarjeta; las grabaciones usan el reproductor local. Los enlaces externos se abren en sus sitios: no se descarga ni se integra nada de la red.
- Para copiar utilidad, adjunta una ronda, elige el jugador de la demo bajo una tarea y pulsa «Copiar lanzamientos» (primero se elige el jugador cuyo nombre en la demo coincide con el hueco). Los lanzamientos del intervalo se copian con tipo de granada, posición en el suelo, ángulos, `setpos`/`setang` y enlace a la repetición. Repetir la importación no duplica los mismos lanzamientos. Guarda la entrada para conservar los cambios.
- «Añadir a nuestro playbook» en una estrategia del dosier guarda su firma de utilidad y rondas de ejemplo. La página de agregado permite detectar estrategias en los partidos seleccionados de un mapa con los alias indicados y guardarlas también. Los detectores estiman usos y victorias en nuestros partidos de ese mapa con el mismo umbral de sitio y zonas de humos/molotovs del dosier, excluyendo la utilidad posterior al plant. Es una heurística para estrategias T, no una prueba de la táctica elegida; las entradas escritas a mano no tienen detector salvo que se adopten desde el análisis.
- TXT, Markdown, XLSX e «Imprimir / PDF» exportan las entradas del libro y filtros actuales. Incluyen texto, comandos y enlaces a adjuntos; no integran vídeos ni imágenes de pizarras. La exportación de paquetes en la Biblioteca incluye el playbook si se selecciona y combina las entradas/libros más nuevos por ID. Los adjuntos viajan como referencias: añade las pizarras, listas y partidos analizados necesarios; las grabaciones se quedan en el ordenador original.

### Aplicación: rival (dosier)

Página «Rival»: equipo, mapa, últimas N partidas, lado y tipo de ronda se eligen una vez en el panel superior y se aplican a todas las pestañas. La selección se guarda en la dirección (`#/scout/<equipo>/<mapa>/<pestaña>?last=&side=&buy=&rounds=`), así que un enlace abre exactamente lo mismo. Selección rápida: últimas 10 pistolas, full buys, forces o ecos.

| Pestaña | Contenido |
|---|---|
| Resumen | Conclusiones: sitio favorito, estrategia principal, ritmo, granada principal, jugador débil, comportamiento tras perder las pistolas, colocación CT. Cada una con número de rondas y enlaces a rondas de ejemplo; menos de 5 rondas se marca como «pocos datos». Las tablas están ocultas bajo «mostrar datos». |
| Tiempos | Cuadrícula «zona × segundo» (paso de 5 s) de granadas y primeras entradas del equipo; un clic en una celda muestra las rondas. |
| Playbook | Rondas como T agrupadas en estrategias: un mismo sitio y en general los mismos humos y molotovs (similitud de conjuntos de al menos 0,5), mínimo 2 rondas. Abajo, todas las rondas y la búsqueda de rondas similares en toda la biblioteca de este mapa. |
| Heatmap | Los mismos modos que en la partida, sobre las rondas elegidas de todas las partidas. |
| Economía | Ronda tras las pistolas, compra según racha de derrotas, victorias por lado y compra, sitio por tipo de ronda. |
| Jugadores | ADR, K/D, aperturas, trade rate, distancia al compañero más cercano durante el primer minuto de la ronda, armas; dónde está el jugador en el segundo 15 y en qué zonas no aparece nunca. |
| Granadas, Clips | Lineups y constructor de clips siguen los filtros de arriba: mapa, equipo (con sus otros nombres), lado, compra y selección de rondas; solo lanzamientos y jugadores de ese equipo. Cambiar un filtro actualiza ambos a la vez. |

**Equipo.** En la demo el equipo se llama según su clan tag o su capitán (`team_<nick>` en FACEIT), así que un mismo equipo puede tener muchos nombres. En la página «Rival» se les puede dar un único nombre («Nombres de equipos…»); se guarda en `library.json`. La aplicación propone por sí misma unir nombres con tres o más jugadores en común. La estrella junto a un equipo lo marca como propio: en el menú aparece la opción «Nosotros» mientras la biblioteca tenga partidas de ese equipo.

**Últimas partidas.** La cabecera de la demo no tiene fecha, así que el orden se toma de la fecha del archivo de la demo y, si no hay archivo, de la fecha del análisis. En una demo subida desde el navegador es la hora de subida, no la del partido.

**Exportación.** El botón MD descarga el dosier en Markdown; el botón PDF abre la impresión del navegador con una versión de la página sin interfaz.

### Aplicación: granadas, lineups y CS2

Pestaña de partida «Granadas y lineups» y página «Lineups» (lanzamientos de varias demos del mismo mapa). El enfoque de lineups y comandos de CS2 está tomado de [cs2-meta-engine](https://github.com/Twoos123/cs2-meta-engine).

- **Lanzamiento** (`freezetime/lineups.py`) — un `weapon_fire` de granada de `shots`: posición de los pies del lanzador, pitch/yaw en el momento del lanzamiento, tipo de granada. Se le asocia una trayectoria de `grenades` que empieza como mucho 32 ticks después, del mismo tipo y la más cercana al lanzador (en 9 demos se asociaron 3339 de 3349 lanzamientos, 99,7%). De ahí salen el punto donde se detuvo la granada y el tiempo hasta detenerse.
- **Técnica** — según los fotogramas de repetición alrededor del lanzamiento: pies más de 8 unidades por encima del suelo antes del lanzamiento — salto; velocidad mayor de 170 unidades/s — carrera; mayor de 40 — andando; si no, quieto (`salto`, `carrera + salto`, `corriendo`, `andando`, `quieto`). En los lanzamientos con salto, el lineup guarda la altura del suelo desde la que se saltó. El agachado no se detecta: no está en los fotogramas de repetición.
- **Lineup** — grupo de lanzamientos de la misma granada desde posiciones a menos de 64 unidades, con ángulo de mirada de ±8° y aterrizaje a menos de 160 unidades. El representante del grupo es el lanzamiento más cercano a los demás. Las zonas «desde» y «hacia» salen de la configuración del mapa.
- **Filtros** — tipo, lado, equipo, jugador, técnica, zona de aterrizaje, número mínimo de lanzamientos en el lineup.
- **Mapa** — lugares de aterrizaje (tamaño: número de lanzamientos), líneas desde el lugar del lanzamiento; un clic elige un lineup y muestra todos sus lanzamientos, la posición y la dirección de la mirada.

**Exportación**:

- **CSV** (UTF-8 con BOM, se abre en Excel) y **JSON** — todos los lanzamientos filtrados: partida, ronda, tiempo, jugador, equipo, lado, tipo, técnica, zonas, coordenadas de lanzamiento y aterrizaje, pitch/yaw, tiempo de vuelo y comando de consola listo.
- **.cfg** — configuración de práctica: un lanzamiento por lineup, las teclas `]` / `[` cambian de lineup y al cambiar se escribe el nombre en la consola. Al principio, ajustes del servidor local: `sv_cheats 1`, granadas infinitas, vista previa de trayectoria (`sv_grenade_trajectory_prac_pipreview 1`), ronda de 60 minutos, sin freezetime, sin bots.
- **Instalar en CS2** — la misma configuración se escribe directamente en `game/csgo/cfg` (`freezetime_<nombre>.cfg`); **Ejecutar lista** carga el mapa y ejecuta `exec`.

**Abrir en CS2** (`freezetime/app/cs2.py`) coloca al jugador en la posición del lanzamiento: carga el mapa en un servidor local, activa los ajustes de práctica, teletransporta (`setpos`), apunta (`setang`) y da la granada (`give`, `use`).

- La carpeta del juego se encuentra sola, mediante el registro de Steam y `libraryfolders.vdf`; se puede indicar a mano en el bloque «CS2».
- Las versiones actuales de CS2 ignoran `-netconport`, así que los comandos van por una tecla: escribe una vez en la consola del juego `bind f13 "exec freezetime_cmd"` y la aplicación detecta el bind en las teclas guardadas del juego. Los comandos se escriben en `cfg/freezetime_cmd.cfg` y se ejecutan pulsando F13. En el menú principal los binds no funcionan, así que al cargar una demo la aplicación escribe `exec freezetime_cmd` en la consola por sí misma; antes la consola debe estar cerrada. Las teclas se envían como mensajes directamente a la ventana del juego (el juego no acepta `SendInput`: Windows lo rechaza) y solo mientras la ventana del juego está en primer plano. `con_logfile` no está disponible en el juego: el juego solo puede confirmar comandos con `-condebug` (escribe `csgo/console.log`); sin él la aplicación usa pausas medidas y vuelve a cargar el mapa o la demo en cada pulsación (unos 30 s), porque no sabe dónde está ahora el jugador. Con `-condebug`, una nueva pulsación en el mismo mapa o demo funciona al momento.
- Si CS2 no está abierto, el navegador lo lanza mediante `steam://run`; Steam pide confirmar los parámetros de lanzamiento. Sin la conexión configurada, el juego solo abrirá el mapa o la demo; el resto de comandos no tiene adónde ir.
- **Copiar comando** — una línea `sv_cheats 1; setpos …; setang …; give …; use …` para la consola, si no necesitas la consola de red.
- **demo en CS2** en cada lanzamiento abre la demo original (`playdemo`) 5 s antes del lanzamiento y cambia la cámara al lanzador (`spec_player`). Funciona si la demo está dentro de la carpeta del juego (por ejemplo, en `game/csgo`).
- No pulses estos botones durante una partida de matchmaking: cambiar de mapa te desconectará de la partida.

## Metodología

Todos los umbrales son constantes al principio de los módulos; se cambian ahí mismo.

**Rondas.** Las rondas de cuchillo se excluyen. Una fila pertenece a una ronda si su tick está en `[start_tick, end_tick]` (`with_round`). Los ticks entre rondas se descartan. Si la primera ronda no tiene `start_tick` (la grabación empezó en el calentamiento o durante la ronda), la ronda empieza un tiempo de congelación habitual (la mediana de las demás rondas) antes de su fin, para que las kills del calentamiento y de una ronda de cuchillo no grabada no cuenten en la ronda 1.

**Lados.** El lado de un equipo en una ronda es la mayoría según las instantáneas de sus jugadores en esa ronda. El equipo es `team_clan_name` de `players`. Los entrenadores — filas de `stats` sin kills, muertes, asistencias ni daño — se excluyen de los jugadores y de las medias.

**Trades y aperturas.** Los indicadores `is_trade` y `victim_traded` vienen de awpy: una kill que venga a un compañero en menos de 5,25 s. Apertura: la primera kill entre equipos de la ronda.

**Zonas del mapa.** Cada zona de la configuración pertenece a un grupo:
- `A` / `B` — el sitio y las posiciones CT a su alrededor (por ejemplo, Jungle y Stairs en Mirage);
- `A_approach` / `B_approach` — caminos de los T al sitio;
- `mid`, `t_spawn`, `ct_spawn`.

Un punto se busca entre los polígonos de su nivel (por `z`). Si las zonas se solapan, gana la más pequeña. Los puntos a menos de 64 unidades de una zona se asignan a la más cercana (`maps/__init__.py`: `CELL`, `SNAP`).

**Cómo se crea la configuración a partir de demos** (`mapgen.py`):
- **Callouts.** El juego etiqueta cada posición del jugador con el nombre de un lugar nav (`m_szLastPlaceName`). Las posiciones se reparten en celdas de 32 unidades por separado para cada nivel. Cada celda recibe el lugar más frecuente. Se rellenan los huecos pequeños y se eliminan las islas. Los contornos se trazan con marching squares y se simplifican (`CELL`, `MIN_SAMPLES`, `MIN_CELLS`, `SIMPLIFY`).
- **Sitios.** El indicador `m_bInBombZone` (lo mismo que `func_bomb_target`) solo se activa para los T. Un sitio es la envolvente convexa de un clúster de esos puntos. Se le añaden las plantas de ese sitio y la envolvente se amplía `ZONE_PAD` = 40 unidades. La letra del sitio sale de las plantas de dentro o, si no, del nombre del lugar.

**Ejecuciones T** (`tactics.py`).
- Cuenta una granada que cayó en una zona del grupo `A`/`B`. Una granada en el spawn CT cuenta para el sitio más cercano: son humos al CT.
- **Sitio objetivo** — el sitio de la planta; sin planta, el sitio donde cayeron más granadas T hasta el final de la ronda.
- **Inicio de la ejecución** — la primera granada T en el sitio objetivo.
- **Ritmo** — según el tiempo de inicio desde el fin del freezetime: antes de `EARLY_SEC` = 30 s — early; de 30 a `LATE_SEC` = 60 s — mid; después — late.
- **Paquete** — granadas al sitio de la planta desde el inicio de la ejecución hasta la planta.
- **`entry`** — en qué zonas estaban los T vivos en el momento del inicio. Si no hay inicio, `PACKAGE_SEC` = 25 s antes de la planta.
- **`package_zones`** — en qué callouts cayeron las granadas del paquete.
- **Quién lanzó.** En estas demos las granadas tienen `thrower_*` vacío. El lanzador se reconstruye así: `events/weapon_fire.userid` se empareja fila a fila con `shots.steamid` (`userid_map`). Un molotov se asocia al último `grenade_thrown` como mucho 6 s antes de la ignición.

**Setups CT.**
- Las posiciones de los CT vivos se toman `SETUP_SEC` = 15 s después del freezetime o en el momento del primer contacto, si es antes. Primer contacto: el primer daño al rival.
- Un CT en el grupo `A` o `A_approach` cuenta como jugador de A; en `B` / `B_approach`, como jugador de B; el resto, mid.
- Ejemplo de registro: `A2 B2 M1`.

**Rotaciones CT** (rondas con planta).
- El punto de referencia es el inicio de la ejecución o, si no, la planta menos `PACKAGE_SEC`.
- Los que rotan son los CT que en ese momento no están en el grupo del sitio de la planta.
- Un jugador que rota «ha llegado» cuando aparece por primera vez en el grupo del sitio antes del final de la ronda.
- Se calculan el número medio de jugadores que rotan y que llegan (incluido antes de la planta), el tiempo medio de rotación y el porcentaje de retakes ganados.

**Heurística de reserva** — para mapas sin configuración; al usarla se muestra un aviso.
- Los centros de los sitios son las posiciones medias de las plantas de la demo, así que hace falta al menos una planta en cada sitio.
- «En el sitio» — a menos de `SITE_RADIUS` = 0,20 de la distancia A–B.
- «Defiende el sitio» — a menos de `DEFEND_RADIUS` = 0,40 de la distancia A–B.
- Ajustada en de_anubis.

**Agregación.** Los contadores se suman; los porcentajes y ratios se recalculan a partir de las sumas. Las medias (ADR, tiempo de planta, …) se ponderan por su denominador. Una misma demo añadida dos veces da contadores duplicados y los mismos porcentajes (lo comprueba un test). Las tácticas siempre se desglosan por mapa.

## Limitaciones y particularidades de los datos

- **Granadas sin lanzador.** En `grenades`/`smokes`/`fires` el `thrower_*` está vacío; el lanzador se reconstruye (ver «Ejecuciones T»). Si `weapon_fire` y `shots` no coinciden fila a fila, las tácticas y el mapa de granadas no están disponibles para la partida: en la CLI habrá un error, en la aplicación, un mensaje.
- **`start_tick` vacío en la primera ronda** de algunas demos (la grabación empezó en el calentamiento o durante la ronda): la ronda empieza una congelación mediana antes de su fin; antes se usaba el tick 0 y la ronda 1 recibía las kills del calentamiento y de la ronda de cuchillo.
- **Los eventos guardan los campos como cadenas**; `x`/`y`/`z` se convierten a número.
- **Las instantáneas** van con paso de 0,5 s (`Match.snap_step`, 32 ticks a 64 tick). En algunas demos los ticks de las instantáneas empiezan en 1 y no en 0 (`Match.snap_offset`); antes, por eso, los setups, rotaciones y `viz frame/gif` salían vacíos en esas demos.
- **Progreso del análisis.** awpy no informa del progreso dentro del análisis, así que se muestra por etapas. La primera etapa («parsing demo») es la más larga.
- **Los sitios creados a partir de demos se basan en las posiciones de los jugadores**, así que el borde de la zona de plantado puede desviarse hasta ~40 unidades. Los sitios donde los T casi no se colocan salen más pequeños de lo que son.
- **Cache y Nuke no están verificados con demos**: puede haber imprecisiones en nombres y límites de zonas auxiliares.
- **Quién lanzó la granada en la repetición** — el jugador vivo más cercano al primer punto de la trayectoria (hasta 120 unidades). Con lanzamientos pegados a un compañero puede haber confusión. Esto también decide qué granadas entran en el clip de un jugador. El punto de lanzamiento se empareja aparte: el `weapon_fire` de una granada del mismo tipo como mucho 32 ticks antes del inicio de la trayectoria y a menos de 160 unidades de su primer punto; una granada sin ese evento no tiene punto de lanzamiento.
- **El trazador de un fallo** no sabe de paredes: un rayo de longitud fija muestra la dirección del disparo, no dónde dio la bala. El trazador de un acierto es exacto (hasta el herido).
- **El inventario** sale de instantáneas con paso de 0,5 s: una granada lanzada puede desaparecer del icono con hasta 0,5 s de retraso.
- **`rar` y `7z`** se extraen con el `tar.exe` del sistema (bsdtar). Si no está (Windows anterior a 10, Linux sin `bsdtar`), esos archivos no se subirán: extráelos a mano o usa `zip`.
- **MP4** requiere WebCodecs. En un navegador sin ellos el botón MP4 está desactivado y queda GIF.
- **Lineups**: la posición son los pies del lanzador en el momento del lanzamiento (en un salto, el suelo antes de saltar), así que en lanzamientos corriendo o saltando el punto de inicio indica dónde salió la granada y la carrerilla hay que repetirla uno mismo. La fuerza del lanzamiento (botón izquierdo/derecho) y el agachado no se detectan.
- **La consola de red de CS2** se probó con un emulador: comandos, orden, espera de la línea `CS2_GAME_UI_STATE_INGAME` tras cargar el mapa. Si el juego no escribe esa línea, los comandos se envían tras 90 s de espera.
- **Los entrenadores** se detectan por una fila a cero en `stats`; un entrenador que de verdad jugó rondas cuenta como jugador.

## Licencia

Freezetime tiene el código disponible para leer, pero no es open source. Puedes leer el código y ejecutar la app sin
modificar con fines no comerciales (para ti o tu equipo). El uso comercial, la modificación, la copia, la redistribución
y las obras derivadas no están permitidos sin el permiso escrito del autor. Los términos completos están en
[LICENSE](LICENSE) (la versión en inglés es la vinculante).
