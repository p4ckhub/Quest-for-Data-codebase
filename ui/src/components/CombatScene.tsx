import React, { useState, useEffect } from "react";
import { useGameStore } from "../store";

// Combat participant stats
interface CombatStats {
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  class?: string;
  level?: number;
}

// Get player's attack_style from store based on class
function getAttackStyle(playerClass: string): string {
  const classes = useGameStore.getState().classes;
  return classes[playerClass]?.attack_style || "melee";
}

interface EnemyStats {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  level?: number;
}

// Props for CombatScene
interface CombatSceneProps {
  player: CombatStats;
  enemy: EnemyStats;
  turn?: number;
  combatState?: "player-turn" | "enemy-turn" | "victory" | "defeat";
  reducedMotion?: boolean;
  animationSpeed?: number;
  onCombatTurn?: (action: string) => Promise<any>;
}

const CombatScene: React.FC<CombatSceneProps> = ({
  player,
  enemy,
  turn = 1,
  combatState = "player-turn",
  reducedMotion = false,
  animationSpeed = 1,
  onCombatTurn = async () => {},
}) => {
  // Use provided settings directly (from props, not store)
  const effectiveAnimationSpeed = animationSpeed > 0 ? animationSpeed : 1;
  const effectiveReducedMotion = reducedMotion;

  // Animation duration in ms, affected by speed setting
  // Speed 0 = instant, Speed 1 = normal (500ms), Speed 2 = fast (250ms)
  const getDuration = (base: number) => {
    if (effectiveReducedMotion) return 0;
    const multiplier = 1 / effectiveAnimationSpeed;
    return Math.max(0, base * multiplier);
  };

  // Floating damage numbers state
  const [floatingTexts, setFloatingTexts] = useState<Array<{
    id: number;
    text: string;
    x: number;
    y: number;
    target: "player" | "enemy" | "center" | string;
  }>>([]);

  // Add floating damage text
  const addFloatingText = (text: string, target: string = "center", offset: number = 0) => {
    const id = Date.now() + Math.random();
    setFloatingTexts((prev) => [
      ...prev,
      { id, text, x: 50 + offset, y: 40, target: target as any },
    ]);

    // Remove after animation
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((ft) => ft.id !== id));
    }, 1000 / effectiveAnimationSpeed);
  };

  // Lunge animation state for player attack (melee)
  const [lungeActive, setLungeActive] = useState(false);
  
  // Projectile animation state (projectile_physical, projectile_magic)
  const [projectileActive, setProjectileActive] = useState(false);

  // Animation handler for lunge (melee classes)
  const triggerLunge = () => {
    if (effectiveReducedMotion) return;
    setLungeActive(true);
    const duration = getDuration(500); // 500ms normal, less with speed
    setTimeout(() => {
      setLungeActive(false);
    }, duration);
  };
  
  // Projectile attack animation handler
  const triggerProjectile = (attackStyle: string) => {
    if (effectiveReducedMotion) return;
    setProjectileActive(true);
    const duration = getDuration(600); // Slightly longer for projectile travel time
    setTimeout(() => {
      setProjectileActive(false);
    }, duration);
  };

  // Apply damage to enemy and show floating text (for future use)
  const applyDamage = (amount: number) => {
    if (effectiveReducedMotion) return;
    addFloatingText(`-${amount}`, "enemy", 10);
    
    // Branch on attack_style to trigger appropriate animation
    const attackStyle = getAttackStyle(player.class || "warrior");
    if (attackStyle === "melee") {
      triggerLunge();
    } else {
      // projectile_physical and projectile_magic use projectile animation
      triggerProjectile(attackStyle);
    }
  };

  // Calculate XP formula: level = 1 + floor(sqrt(xp / 100))
  const calculateLevelFromXp = (xp: number): number => {
    return 1 + Math.floor(Math.sqrt(xp / 100));
  };

  // Determine if combat is over
  const isVictory = combatState === "victory" || enemy.hp <= 0;
  const isDefeat = combatState === "defeat" || player.hp <= 0;

  // Format health bars
  const playerHpPercent = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
  const playerMpPercent = Math.max(0, Math.min(100, (player.mp / player.maxMp) * 100));
  const enemyHpPercent = Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));

  // CSS classes for reduced motion
  const lungeClass = lungeActive && !effectiveReducedMotion ? "lunge-attack" : "";
  const projectileClass = projectileActive && !effectiveReducedMotion ? "projectile-attack" : "";
  const animationDuration = isVictory || isDefeat ? "0s" : `${getDuration(500)}ms`;
  
  // Branch on attack_style to determine CSS class
  const attackStyle = getAttackStyle(player.class || "warrior");
  const attackClass = attackStyle === "melee" ? lungeClass : projectileClass;

  return (
    <div className="combat-scene">
      {/* Player section - left side */}
      <div className={`combat-player ${attackClass}`} style={{ transition: `transform ${animationDuration}` }}>
        <div className="sprite-container">
          <div className={`player-sprite ${player.class || "warrior"}`} />
        </div>
        {/* HP Bar */}
        <div className="hp-bar-container">
          <div className="hp-label">HP</div>
          <div className="hp-bar-track">
            <div
              className="hp-bar-fill"
              style={{ width: `${playerHpPercent}%` }}
            />
          </div>
          <div className="hp-text">{Math.max(0, player.hp)}/{player.maxHp}</div>
        </div>
        {/* MP Bar */}
        <div className="mp-bar-container">
          <div className="mp-label">MP</div>
          <div className="mp-bar-track">
            <div
              className="mp-bar-fill"
              style={{ width: `${playerMpPercent}%` }}
            />
          </div>
          <div className="mp-text">{Math.max(0, player.mp)}/{player.maxMp}</div>
        </div>
        {/* Level info */}
        {player.level !== undefined && (
          <div className="level-info">Level {player.level}</div>
        )}
      </div>

      {/* Enemy section - right side */}
      <div className="combat-enemy">
        <div className="enemy-name">{enemy.name}</div>
        <div className="sprite-container">
          <div className={`enemy-sprite enemy-${enemy.id}`} />
        </div>
        {/* Enemy HP Bar */}
        <div className="enemy-hp-bar-container">
          <div className="hp-label">HP</div>
          <div className="enemy-hp-bar-track">
            <div
              className="enemy-hp-bar-fill"
              style={{ width: `${enemyHpPercent}%` }}
            />
          </div>
          <div className="hp-text">{Math.max(0, enemy.hp)}/{enemy.maxHp}</div>
        </div>
      </div>

      {/* Combat info */}
      <div className="combat-info">
        <div className="turn-counter">Turn {turn}</div>
        <div className="combat-state">
          {isVictory ? "VICTORY" : isDefeat ? "DEFEAT" : combatState.toUpperCase()}
        </div>
      </div>

      {/* Action bar - only show in player turn */}
      {combatState === "player-turn" && !isVictory && !isDefeat && (
        <div className="combat-actions">
          <button className="cast-button" onClick={() => onCombatTurn("cast")}>
            CAST
          </button>
          {/* Add spell dropdown here when spellbook is integrated */}
        </div>
      )}

      {/* Victory/Defeat overlay */}
      {(isVictory || isDefeat) && (
        <div className="combat-result-overlay">
          {isVictory ? (
            <div className="victory-message">
              <h2>Victory!</h2>
              <p>The enemy has been defeated.</p>
              {/* XP award would be shown here */}
            </div>
          ) : (
            <div className="defeat-message">
              <h2>Defeat</h2>
              <p>You have fallen in battle.</p>
              {/* Retry button would be here */}
            </div>
          )}
        </div>
      )}

      {/* Floating damage numbers container */}
      {floatingTexts.map((ft) => (
        <div
          key={ft.id}
          className="floating-damage"
          style={{
            position: "absolute",
            left: `${ft.x}%`,
            top: `${ft.y}%`,
            transform: "translate(-50%, -50%)",
            animation: effectiveReducedMotion ? "none" : "floatUp 0.8s ease-out forwards",
            color: "#ff6b6b",
            fontWeight: "bold",
            fontSize: "1.5rem",
            textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
          }}
        >
          {ft.text}
        </div>
      ))}
    </div>
  );
};

// Animation keyframes for floating damage
const styles = `
@keyframes floatUp {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -80%) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -120%) scale(1);
  }
}

@keyframes lungeAttack {
  0% { transform: translateX(0); }
  25% { transform: translateX(20px); }
  50% { transform: translateX(0); }
  75% { transform: translateX(-10px); }
  100% { transform: translateX(0); }
}

@keyframes projectileLeftToRight {
  0% { transform: translateX(0) translateY(0); opacity: 1; }
  50% { transform: translateX(300px) translateY(-50px); opacity: 0.8; }
  100% { transform: translateX(600px) translateY(0); opacity: 0; }
}

@keyframes projectileTrailTint {
  0% { filter: hue-rotate(0deg); opacity: 1; }
  50% { filter: hue-rotate(90deg); opacity: 0.8; }
  100% { filter: hue-rotate(180deg); opacity: 0; }
}

.lunge-attack {
  animation: lungeAttack 0.5s ease-in-out;
}

.projectile-attack {
  animation: projectileLeftToRight 0.6s ease-in-out;
}

.combat-scene {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
  background: #0f0f23;
}

.combat-player,
.combat-enemy {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  position: relative;
}

.sprite-container {
  width: 100px;
  height: 100px;
  margin-bottom: 1rem;
}

.player-sprite,
.enemy-sprite {
  width: 100%;
  height: 100%;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

/* Warrior palette */
.warrior .player-sprite {
  background-image: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
}

.warrior .enemy-sprite.enemy-1 {
  background-image: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
}

/* Archer palette (projectile_physical) */
.archer .player-sprite {
  background-image: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
}
.archer .projectile-attack {
  animation: projectileLeftToRight 0.6s ease-in-out;
}

/* Mage palette (projectile_magic - adds trail tint effect) */
.mage .player-sprite {
  background-image: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
}
.mage .projectile-attack {
  animation: projectileTrailTint 0.6s ease-in-out;
}

/* Enemy HP bar */
.enemy-hp-bar-container {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 200px;
}

.hp-bar-container,
.enemy-hp-bar-container {
  width: 200px;
  margin-top: 0.5rem;
}

.hp-label,
.mp-label {
  font-size: 0.8rem;
  color: #e94560;
  margin-bottom: 0.25rem;
}

.hp-bar-track,
.mp-bar-track,
.enemy-hp-bar-track {
  width: 100%;
  height: 12px;
  background: #333;
  border-radius: 6px;
  overflow: hidden;
}

.hp-bar-fill,
.mp-bar-fill,
.enemy-hp-bar-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.3s ease;
}

.hp-bar-fill {
  background: linear-gradient(90deg, #2ecc71 0%, #27ae60 100%);
}

.mp-bar-fill {
  background: linear-gradient(90deg, #3498db 0%, #2980b9 100%);
}

.enemy-hp-bar-fill {
  background: linear-gradient(90deg, #e74c3c 0%, #c0392b 100%);
}

.hp-text,
.mp-text {
  font-size: 0.85rem;
  margin-top: 0.25rem;
  text-align: center;
}

.level-info {
  margin-top: 1rem;
  font-size: 1rem;
  color: #3498db;
}

.enemy-name {
  position: absolute;
  top: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 1.2rem;
  color: #e94560;
}

.combat-info {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
}

.turn-counter,
.combat-state {
  font-size: 1.2rem;
  color: #fff;
  margin: 0 1rem;
}

.combat-actions {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 1rem;
}

.cast-button {
  padding: 1rem 2rem;
  font-size: 1.2rem;
  background: #e94560;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.cast-button:hover {
  background: #ff6b81;
  transform: scale(1.05);
}

.cast-button:active {
  transform: scale(0.95);
}

.combat-result-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.victory-message h2,
.defeat-message h2 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.victory-message h2 {
  color: #2ecc71;
}

.defeat-message h2 {
  color: #e74c3c;
}

.victory-message p,
.defeat-message p {
  font-size: 1.5rem;
  color: #fff;
}
`;

// Inject styles dynamically
if (typeof document !== "undefined") {
  const styleId = "combat-scene-styles";
  if (!document.getElementById(styleId)) {
    const styleElement = document.createElement("style");
    styleElement.id = styleId;
    styleElement.textContent = styles;
    document.head.appendChild(styleElement);
  }
}

export default CombatScene;
