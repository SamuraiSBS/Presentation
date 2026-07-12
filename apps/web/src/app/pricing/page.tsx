import Link from "next/link";
import { Check, Clock3, Folder, Presentation, Share2 } from "lucide-react";
import { MotionCard } from "@/components/motion/motion-card";
import { MotionList, MotionListItem } from "@/components/motion/motion-list";

const features = ["10 новых презентаций в календарный месяц", "Экспорт в PDF и PPTX", "Папки одного уровня без лишней вложенности", "Совместные проекты с ролями редактора и зрителя"];

export default function PricingPage() {
  return (
    <main className="page pricing-page account-page">
      <MotionList className="pricing-header" as="section"><MotionListItem index={0}><p className="account-kicker">Тариф</p></MotionListItem><MotionListItem index={1}><h1 className="page-title">Всё нужное для учёбы — бесплатно</h1></MotionListItem><MotionListItem index={2}><p className="lead">На старте StudyDeck работает без оплаты и банковской карты.</p></MotionListItem></MotionList>
      <MotionCard className="free-plan-card" as="section">
        <div className="free-plan-main"><span className="recommended">Текущий тариф</span><h2>Бесплатный</h2><p className="free-price"><strong>0 ₽</strong><span>навсегда на старте</span></p><MotionList className="plan-features">{features.map((feature, index) => <MotionListItem index={index} key={feature}><p><Check size={18} />{feature}</p></MotionListItem>)}</MotionList><Link className="button" href="/new">Создать презентацию</Link></div>
        <aside className="plan-notes"><div><Presentation size={21} /><span><strong>Лимит обновляется</strong>1-го числа по Москве</span></div><div><Folder size={21} /><span><strong>Работы сохраняются</strong>после исчерпания лимита</span></div><div><Share2 size={21} /><span><strong>Совместные проекты</strong>считаются владельцу</span></div></aside>
      </MotionCard>
      <MotionCard className="coming-plan" as="section"><Clock3 size={22} /><div><h2>Расширенные тарифы появятся позже</h2><p>Оплата пока отключена. Мы сообщим о дополнительных возможностях отдельно.</p></div><span>Скоро</span></MotionCard>
    </main>
  );
}
