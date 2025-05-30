import { useEffect, useState } from 'react';
import styled from 'styled-components';
import Heading from '../ui/Heading';
import Button from '../ui/Button';
import CardSlider from '../ui/CardSlider';

const PracticeCards = () => {
  const [face, setFlipped] = useState('front');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);

  var cardsData = {};

  useEffect(() => {
    fetch('http://localhost:9000/data')
      .then(res => res.json())
      .then(data => {
        cardsData = data;
      });
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDirection('');
      setIsAnimating(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [currentIndex]);

  const flip = () => {
    setFlipped(face => (face == 'front' ? 'back' : 'front'));
  };

  const goToPrev = () => {
    if (face == 'back') flip();
    if (isAnimating) return;
    setIsAnimating(true);
    setDirection('left');
    setCurrentIndex(prev =>
      prev === 0 ? cardsData.cards.length - 1 : prev - 1
    );
  };

  const goToNext = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setDirection('right');
    setCurrentIndex(prev =>
      prev === cardsData.cards.length - 1 ? 0 : prev + 1
    );
    if (face == 'back') flip();
  };

  return (
    <>
      <Heading as="h1">{cardsData.title}</Heading>
      <Container>
        <CardSlider
          face={face}
          cards={cardsData}
          currentIndex={currentIndex}
          direction={direction}
          isAnimating={isAnimating}
        />
      </Container>

      <Row>
        <Button onClick={goToPrev}>&lt;</Button>
        <Button onClick={flip}>Flip</Button>
        <Button onClick={goToNext}>&gt;</Button>
      </Row>
    </>
  );
};

const Container = styled.div`
  align-items: center;
  display: flex;
  justify-content: center;
  flex-direction: column;
  gap: 3.2rem;
`;

const Row = styled.div`
  display: flex;
  justify-content: space-around;
  align-items: center;
`;

export default PracticeCards;
