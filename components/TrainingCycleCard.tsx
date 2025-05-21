import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Target, Calendar } from 'lucide-react-native';
import { router } from 'expo-router';
import type { TrainingCycle } from '@/types/database.types';
import CycleSummaryModal from './CycleSummaryModal';
import { supabase } from '@/lib/supabase';

type Props = {
  cycle: TrainingCycle;
  onUpdate: () => void;
};

export default function TrainingCycleCard({ cycle, onUpdate }: Props) {
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cycleProgress, setCycleProgress] = useState<{
    exercise: string;
    startWeight: number;
    endWeight: number;
    percentageChange: number;
  }[]>([]);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('sv-SE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleEndCycle = async () => {
    try {
      setLoading(true);
      
      // Call the RPC function to end the cycle
      const { error } = await supabase.rpc('end_training_cycle', {
        p_cycle_id: cycle.id
      });
      
      if (error) throw error;
      
      // Close the modal and update the parent component
      setShowSummaryModal(false);
      onUpdate();
    } catch (err) {
      console.error('Error ending cycle:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleShowSummary = async () => {
    try {
      setLoading(true);
      
      // Fetch cycle progress data
      const { data, error } = await supabase.rpc('get_cycle_progress', {
        p_cycle_id: cycle.id
      });
      
      if (error) throw error;
      
      // Format the data for the modal
      const formattedProgress = data.map((item: any) => ({
        exercise: item.exercise_name,
        startWeight: item.start_weight,
        endWeight: item.end_weight,
        percentageChange: item.percentage_change
      }));
      
      setCycleProgress(formattedProgress);
      setShowSummaryModal(true);
    } catch (err) {
      console.error('Error fetching cycle progress:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Target size={24} color="#009dff" />
        </View>
        <Text style={styles.title}>Aktuellt träningsmål</Text>
      </View>

      <Text style={styles.goal}>{cycle.goal}</Text>

      <View style={styles.dateContainer}>
        <Calendar size={16} color="#808080" />
        <Text style={styles.dateText}>
          Startade {formatDate(cycle.start_date)}
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <Pressable
          style={styles.endCycleButton}
          onPress={handleShowSummary}
        >
          <Text style={styles.endCycleButtonText}>Avsluta cykel</Text>
        </Pressable>

        <Pressable
          style={styles.newCycleButton}
          onPress={() => router.push('/profile/new-cycle')}
        >
          <Text style={styles.newCycleButtonText}>Starta ny cykel</Text>
        </Pressable>
      </View>

      <CycleSummaryModal
        visible={showSummaryModal}
        onClose={() => setShowSummaryModal(false)}
        onConfirmEnd={handleEndCycle}
        cycle={cycle}
        loading={loading}
        cycleProgress={cycleProgress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,157,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,157,255,0.3)',
  },
  title: {
    fontSize: 16,
    color: '#FFFFFF',
    fontFamily: 'Inter-SemiBold',
  },
  goal: {
    fontSize: 18,
    color: '#FFFFFF',
    fontFamily: 'Inter-Regular',
    marginBottom: 16,
    lineHeight: 24,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  dateText: {
    color: '#808080',
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  buttonContainer: {
    gap: 12,
  },
  endCycleButton: {
    backgroundColor: '#333333',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  endCycleButtonText: {
    color: '#FF4444',
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
  },
  newCycleButton: {
    backgroundColor: '#009dff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  newCycleButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
  },
});