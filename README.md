# Dust We Are

*Somos polvo de estrellas. Devuélvele su forma de mundo.*
*We are stardust. Give it back its shape as worlds.*

**Jugar / Play:** https://dinover.github.io/DustWeAre/

---

## Español

Un juego de gestión tranquilo sobre el nacimiento de un sistema solar. Del polvo que una nebulosa planetaria devolvió al espacio nace una estrella nueva, rodeada de un disco de gas, polvo y hielo. Tu tarea es convertir ese disco en mundos y, con paciencia, hacer que la vida aparezca, crezca y un día parta hacia otras estrellas.

### Cómo se juega

1. **Formación.** Mantén pulsado sobre el disco para *reunir* polvo en piedras: cada cuerpo barre su órbita y crece. *Calentar* aleja el gas y el polvo ligero; *Enfriar* calma el disco y hace nacer piedras; *Empujar* cambia órbitas y provoca choques (a veces nacen lunas). Más allá de la línea de nieve crecen los gigantes, si atrapan el gas antes de que la estrella lo disperse.
2. **Mundos habitables.** Toca un mundo para ver qué le falta. Atrae *cometas* (agua, orgánicos, aire o hierro), despierta sus *volcanes* o *migra* su órbita hacia la zona habitable. Toca la estrella para ajustar su brillo.
3. **Vida.** Cuando las condiciones son buenas, la vida aparece sola y avanza: microbios, vida compleja, inteligencia, civilización y era espacial. Mantén estable su mundo frente a eras glaciales, calentamientos y asteroides.
4. **Hacia las estrellas.** Tu especie viaja entre mundos, lanza satélites y terraforma. Si llegan visitantes de otra estrella, expúlsalos con *llamaradas solares*. Cuando habite todos tus mundos, su arca partirá hacia otro sistema… y podrás sembrarlo.

Viene de [Universe is Born](https://dinover.github.io/UniverseIsBorn/): cuando tu galaxia tiene una nebulosa planetaria, el Observatorio abre este viaje.

## English

A calm management game about the birth of a solar system. From the dust a planetary nebula returned to space, a new star is born, wrapped in a disk of gas, dust and ice. Your task is to turn that disk into worlds and, patiently, let life appear, grow and one day set out for other stars.

### How to play

1. **Formation.** Hold on the disk to *gather* dust into pebbles: each body sweeps its orbit and grows. *Heat* pushes gas and light dust away; *Cool* calms the disk and makes pebbles form; *Nudge* changes orbits and causes collisions (sometimes moons are born). Giants grow beyond the snow line, if they catch the gas before the star blows it away.
2. **Habitable worlds.** Tap a world to see what it lacks. Bring in *comets* (water, organics, air or iron), wake its *volcanoes* or *migrate* its orbit towards the habitable zone. Tap the star to adjust its brightness.
3. **Life.** When conditions are right, life appears on its own and moves on: microbes, complex life, intelligence, civilization and the space age. Keep its world steady through ice ages, warming and asteroids.
4. **To the stars.** Your species travels between worlds, launches satellites and terraforms. If visitors from another star arrive, drive them out with *solar flares*. Once it lives on every world, its ark sets out for another system… and you can seed it.

It continues [Universe is Born](https://dinover.github.io/UniverseIsBorn/): once your galaxy holds a planetary nebula, the Observatory opens this journey.

---

## Desarrollo / Development

```bash
npm install
npm run dev      # servidor local / local server
npm run build    # comprobación de tipos + compilación / typecheck + build
```

Vite + TypeScript + Three.js. Sin recursos externos: el sonido y las texturas se generan en el navegador. / No external assets: sound and textures are generated in the browser.

`?lang=es` o `?lang=en` fija el idioma; `?from=uib` muestra la bienvenida desde Universe is Born. / `?lang=es` or `?lang=en` sets the language; `?from=uib` shows the welcome from Universe is Born.
