# Dust We Are

*Somos polvo de estrellas. Devuélvele su forma de mundo.*
*We are stardust. Give it back its shape as worlds.*

**Jugar / Play:** https://dinover.github.io/DustWeAre/

---

## Español

Un juego de gestión tranquilo sobre el nacimiento de un sistema solar. Del polvo que una nebulosa planetaria devolvió al espacio nace una estrella nueva, rodeada de un disco de gas, polvo y hielo. Tu tarea es convertir ese disco en mundos y, con paciencia, hacer que la vida aparezca, crezca y un día parta hacia otras estrellas.

### Cómo se juega

1. **Formación.** Mantén pulsado sobre el disco para *reunir* polvo en piedras: cada cuerpo barre su órbita y crece. *Calentar* aleja el gas y el polvo ligero; *Enfriar* calma el disco y hace nacer piedras; *Empujar* cambia órbitas y provoca choques (a veces nacen lunas). Más allá de la línea de nieve crecen los gigantes, si atrapan el gas antes de que la estrella lo disperse.
2. **Mundos habitables.** Toca un mundo para ver qué le falta: cada condición (temperatura, agua, aire, orgánicos, campo magnético, tamaño) tiene un medidor con su zona ideal, así se ve enseguida si sobra o falta. Atrae *cometas* (agua, orgánicos, aire o hierro), despierta sus *volcanes* o *migra* su órbita hacia la zona habitable. Toca la estrella para ajustar su brillo.
3. **Vida.** Cuando las condiciones son buenas, la vida aparece sola y avanza: microbios, vida compleja, inteligencia, civilización y era espacial. Mantén estable su mundo frente a eras glaciales, calentamientos y asteroides.
4. **Pueblos.** No eres ninguno de ellos: los observas a todos, como a un hormiguero. Cada mundo vivo puede dar su propio pueblo (hasta cuatro), cada uno con su color. Viajan entre mundos, lanzan satélites y terraforman. Cada tipo de mundo aporta un recurso: los gigantes dan *combustible*, los helados *agua*, los rocosos *metal* y los vivos *ciencia* (una luna viva junto a un gigante vale el doble). Hay tráfico constante de cargueros, mineros y mercaderes.
5. **Hacia las estrellas.** Con esos recursos levanta *grandes obras* (ascensor espacial, minería de asteroides, refinerías en las nubes, escudos, flota de defensa, anillo orbital, motor de curvatura, enjambre de Dyson, armada), investiga tecnologías, envía expediciones y lanza la armada en un salto de curvatura. Llegan mercaderes, refugiados, señales de auxilio, artefactos, planetas errantes, supernovas e invasores con naves nodriza. Los pueblos se encuentran, comercian, se alían, se mezclan en pueblos nuevos, discuten y se declaran la guerra por su cuenta. Cuando la tensión crece puedes intervenir con la luz de la estrella (calmar los ánimos o imponer una tregua)… o dejarlos ser. Al final, el *arca estelar* lleva a todos los pueblos a sembrar otro sistema.

Viene de [Universe is Born](https://dinover.github.io/UniverseIsBorn/): cuando tu galaxia tiene una nebulosa planetaria, el Observatorio abre este viaje.

## English

A calm management game about the birth of a solar system. From the dust a planetary nebula returned to space, a new star is born, wrapped in a disk of gas, dust and ice. Your task is to turn that disk into worlds and, patiently, let life appear, grow and one day set out for other stars.

### How to play

1. **Formation.** Hold on the disk to *gather* dust into pebbles: each body sweeps its orbit and grows. *Heat* pushes gas and light dust away; *Cool* calms the disk and makes pebbles form; *Nudge* changes orbits and causes collisions (sometimes moons are born). Giants grow beyond the snow line, if they catch the gas before the star blows it away.
2. **Habitable worlds.** Tap a world to see what it lacks: each condition (temperature, water, air, organics, magnetic field, size) has a gauge with its ideal zone, so you can see at a glance whether there is too much or too little. Bring in *comets* (water, organics, air or iron), wake its *volcanoes* or *migrate* its orbit towards the habitable zone. Tap the star to adjust its brightness.
3. **Life.** When conditions are right, life appears on its own and moves on: microbes, complex life, intelligence, civilization and the space age. Keep its world steady through ice ages, warming and asteroids.
4. **Peoples.** You are none of them: you watch over them all, like an ant farm. Every living world may give rise to its own people (up to four), each with its own colour. They travel between worlds, launch satellites and terraform. Each kind of world gives a resource: giants give *fuel*, icy worlds *water*, rocky worlds *metal* and living worlds *science* (a living moon beside a giant is worth double). Freighters, miners and traders come and go all the time.
5. **To the stars.** With those resources raise *great works* (space elevator, asteroid mining, cloud refineries, shields, defence fleet, orbital ring, warp drive, Dyson swarm, armada), research technologies, send expeditions and launch the armada in a warp jump. Traders, refugees, distress calls, artefacts, wandering planets, supernovae and invaders with motherships arrive. The peoples meet, trade, ally, blend into new peoples, quarrel and go to war on their own. When tension grows you may step in with the light of the star (calm things down or force a truce)… or let them be. In the end, the *star ark* carries every people off to seed another system.

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
